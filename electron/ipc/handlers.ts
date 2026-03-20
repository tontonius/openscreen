import fs from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, screen, shell } from "electron";
import { RECORDINGS_DIR } from "../main";
import { startNativeMacRecorder, stopNativeMacRecorder } from "../native/sckRecorder";

const PROJECT_FILE_EXTENSION = "openscreen";
const SHORTCUTS_FILE = path.join(app.getPath("userData"), "shortcuts.json");

type SelectedSource = {
	name: string;
	[key: string]: unknown;
};

let selectedSource: SelectedSource | null = null;
let currentProjectPath: string | null = null;

function normalizePath(filePath: string) {
	return path.resolve(filePath);
}

function isTrustedProjectPath(filePath?: string | null) {
	if (!filePath || !currentProjectPath) {
		return false;
	}
	return normalizePath(filePath) === normalizePath(currentProjectPath);
}

const CURSOR_TELEMETRY_VERSION = 1;
const KEYBOARD_TELEMETRY_VERSION = 1;
const MOUSE_TELEMETRY_VERSION = 1;
const CURSOR_SAMPLE_INTERVAL_MS = 100;
const MAX_CURSOR_SAMPLES = 60 * 60 * 10; // 1 hour @ 10Hz

interface CursorTelemetryPoint {
	timeMs: number;
	cx: number;
	cy: number;
}

interface KeyboardTelemetryEvent {
	timeMs: number;
	keyType: "key" | "space" | "enter";
}

interface MouseClickTelemetryEvent {
	timeMs: number;
	button: "left" | "right" | "other";
}

interface CaptureBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

let cursorCaptureInterval: NodeJS.Timeout | null = null;
let cursorCaptureStartTimeMs = 0;
let activeCursorSamples: CursorTelemetryPoint[] = [];
let pendingCursorSamples: CursorTelemetryPoint[] = [];
let pendingKeyboardSamples: KeyboardTelemetryEvent[] = [];
let pendingMouseClickSamples: MouseClickTelemetryEvent[] = [];
let cursorHideWindow: BrowserWindow | null = null;
let activeCaptureBounds: CaptureBounds | null = null;

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function stopCursorCapture() {
	if (cursorCaptureInterval) {
		clearInterval(cursorCaptureInterval);
		cursorCaptureInterval = null;
	}
}

async function persistPendingCursorTelemetry(videoPath: string) {
	const telemetryPath = `${videoPath}.cursor.json`;
	if (pendingCursorSamples.length > 0) {
		await fs.writeFile(
			telemetryPath,
			JSON.stringify({ version: CURSOR_TELEMETRY_VERSION, samples: pendingCursorSamples }, null, 2),
			"utf-8",
		);
	}
	pendingCursorSamples = [];
}

async function persistPendingKeyboardTelemetry(videoPath: string) {
	const telemetryPath = `${videoPath}.keyboard.json`;
	if (pendingKeyboardSamples.length > 0) {
		await fs.writeFile(
			telemetryPath,
			JSON.stringify(
				{ version: KEYBOARD_TELEMETRY_VERSION, events: pendingKeyboardSamples },
				null,
				2,
			),
			"utf-8",
		);
	}
	pendingKeyboardSamples = [];
}

async function persistPendingMouseClickTelemetry(videoPath: string) {
	const telemetryPath = `${videoPath}.mouse.json`;
	if (pendingMouseClickSamples.length > 0) {
		await fs.writeFile(
			telemetryPath,
			JSON.stringify(
				{ version: MOUSE_TELEMETRY_VERSION, events: pendingMouseClickSamples },
				null,
				2,
			),
			"utf-8",
		);
	}
	pendingMouseClickSamples = [];
}

function closeCursorHideWindow() {
	if (cursorHideWindow) {
		cursorHideWindow.close();
		cursorHideWindow = null;
	}
}

function sampleCursorPoint() {
	const cursor = screen.getCursorScreenPoint();
	const sourceDisplayId = Number(selectedSource?.display_id);
	const sourceDisplay = Number.isFinite(sourceDisplayId)
		? (screen.getAllDisplays().find((display) => display.id === sourceDisplayId) ?? null)
		: null;
	const display = sourceDisplay ?? screen.getDisplayNearestPoint(cursor);
	const bounds = activeCaptureBounds ?? display.bounds;
	const width = Math.max(1, bounds.width);
	const height = Math.max(1, bounds.height);

	const cx = clamp((cursor.x - bounds.x) / width, 0, 1);
	const cy = clamp((cursor.y - bounds.y) / height, 0, 1);

	activeCursorSamples.push({
		timeMs: Math.max(0, Date.now() - cursorCaptureStartTimeMs),
		cx,
		cy,
	});

	if (activeCursorSamples.length > MAX_CURSOR_SAMPLES) {
		activeCursorSamples.shift();
	}
}

export function registerIpcHandlers(
	createEditorWindow: () => void,
	createSourceSelectorWindow: () => BrowserWindow,
	getMainWindow: () => BrowserWindow | null,
	getSourceSelectorWindow: () => BrowserWindow | null,
	onRecordingStateChange?: (recording: boolean, sourceName: string) => void,
	onSourceSelected?: (source: SelectedSource | null) => void,
) {
	ipcMain.handle("get-sources", async (_, opts) => {
		const sources = await desktopCapturer.getSources(opts);
		return sources.map((source) => ({
			id: source.id,
			name: source.name,
			display_id: source.display_id,
			thumbnail: source.thumbnail ? source.thumbnail.toDataURL() : null,
			appIcon: source.appIcon ? source.appIcon.toDataURL() : null,
		}));
	});

	ipcMain.handle("select-source", (_, source: SelectedSource) => {
		selectedSource = source;
		onSourceSelected?.(selectedSource);
		const sourceSelectorWin = getSourceSelectorWindow();
		if (sourceSelectorWin) {
			sourceSelectorWin.close();
		}
		return selectedSource;
	});

	ipcMain.handle("get-selected-source", () => {
		return selectedSource;
	});

	ipcMain.handle("open-source-selector", () => {
		const sourceSelectorWin = getSourceSelectorWindow();
		if (sourceSelectorWin) {
			sourceSelectorWin.focus();
			return;
		}
		createSourceSelectorWindow();
	});

	ipcMain.handle("switch-to-editor", () => {
		const mainWin = getMainWindow();
		if (mainWin) {
			mainWin.close();
		}
		createEditorWindow();
	});

	ipcMain.handle("store-recorded-video", async (_, videoData: ArrayBuffer, fileName: string) => {
		try {
			const videoPath = path.join(RECORDINGS_DIR, fileName);
			await fs.writeFile(videoPath, Buffer.from(videoData));
			currentProjectPath = null;

			await persistPendingCursorTelemetry(videoPath);

			return {
				success: true,
				path: videoPath,
				message: "Video stored successfully",
			};
		} catch (error) {
			console.error("Failed to store video:", error);
			return {
				success: false,
				message: "Failed to store video",
				error: String(error),
			};
		}
	});

	ipcMain.handle("get-recorded-video-path", async () => {
		try {
			const files = await fs.readdir(RECORDINGS_DIR);
			const videoFiles = files.filter((file) => file.endsWith(".webm"));

			if (videoFiles.length === 0) {
				return { success: false, message: "No recorded video found" };
			}

			const latestVideo = videoFiles.sort().reverse()[0];
			const videoPath = path.join(RECORDINGS_DIR, latestVideo);

			return { success: true, path: videoPath };
		} catch (error) {
			console.error("Failed to get video path:", error);
			return { success: false, message: "Failed to get video path", error: String(error) };
		}
	});

	ipcMain.handle("set-recording-state", (_, recording: boolean) => {
		if (recording) {
			stopCursorCapture();
			activeCursorSamples = [];
			pendingCursorSamples = [];
			pendingKeyboardSamples = [];
			pendingMouseClickSamples = [];
			cursorCaptureStartTimeMs = Date.now();
			sampleCursorPoint();
			cursorCaptureInterval = setInterval(sampleCursorPoint, CURSOR_SAMPLE_INTERVAL_MS);
		} else {
			stopCursorCapture();
			pendingCursorSamples = [...activeCursorSamples];
			activeCursorSamples = [];
			activeCaptureBounds = null;
			pendingKeyboardSamples = [];
			pendingMouseClickSamples = [];
		}

		const source = selectedSource || { name: "Screen" };
		if (onRecordingStateChange) {
			onRecordingStateChange(recording, source.name);
		}
	});

	ipcMain.handle(
		"start-native-screen-recording",
		async (
			_,
			options?: {
				source?: { id?: string; display_id?: string };
				cursorMode?: "always" | "never";
				frameRate?: number;
			},
		) => {
			const timestamp = Date.now();
			const outputPath = path.join(RECORDINGS_DIR, `recording-${timestamp}.mp4`);
			const result = await startNativeMacRecorder({
				outputPath,
				sourceId: options?.source?.id,
				displayId: options?.source?.display_id,
				cursorMode: options?.cursorMode === "never" ? "never" : "always",
				// Keyboard sounds are synthetic in post; keep native recorder audio clean by default.
				microphoneEnabled: false,
				frameRate: Math.max(30, Math.min(120, Math.round(options?.frameRate ?? 60))),
			});

			if (!result.success) {
				activeCaptureBounds = null;
				return {
					success: false,
					code: result.code,
					message: result.message ?? "Failed to start native recorder",
				};
			}

			activeCaptureBounds = {
				x: result.ready?.sourceFrameX ?? 0,
				y: result.ready?.sourceFrameY ?? 0,
				width: Math.max(1, result.ready?.sourceFrameWidth ?? result.ready?.width ?? 1),
				height: Math.max(1, result.ready?.sourceFrameHeight ?? result.ready?.height ?? 1),
			};

			return {
				success: true,
				path: outputPath,
				width: result.ready?.width,
				height: result.ready?.height,
				frameRate: result.ready?.frameRate,
				hasMicrophoneAudio: result.ready?.hasMicrophoneAudio === true,
				sourceFrameX: result.ready?.sourceFrameX,
				sourceFrameY: result.ready?.sourceFrameY,
				sourceFrameWidth: result.ready?.sourceFrameWidth,
				sourceFrameHeight: result.ready?.sourceFrameHeight,
			};
		},
	);

	ipcMain.handle("stop-native-screen-recording", async () => {
		const result = await stopNativeMacRecorder();
		activeCaptureBounds = null;
		if (result.success && result.path) {
			try {
				pendingKeyboardSamples = [...(result.metadata?.keyboardEvents ?? [])];
				pendingMouseClickSamples = [...(result.metadata?.mouseClickEvents ?? [])];
				await persistPendingCursorTelemetry(result.path);
				await persistPendingKeyboardTelemetry(result.path);
				await persistPendingMouseClickTelemetry(result.path);
			} catch (error) {
				console.warn("Failed to persist telemetry for native recording:", error);
			}
		}
		return result;
	});

	ipcMain.handle("hide-system-cursor", () => {
		if (cursorHideWindow) {
			return { success: true };
		}

		const displays = screen.getAllDisplays();
		const bounds = displays.reduce(
			(acc, display) => {
				const left = Math.min(acc.x, display.bounds.x);
				const top = Math.min(acc.y, display.bounds.y);
				const right = Math.max(acc.x + acc.width, display.bounds.x + display.bounds.width);
				const bottom = Math.max(acc.y + acc.height, display.bounds.y + display.bounds.height);
				return {
					x: left,
					y: top,
					width: right - left,
					height: bottom - top,
				};
			},
			{ x: Infinity, y: Infinity, width: 0, height: 0 },
		);

		cursorHideWindow = new BrowserWindow({
			x: bounds.x,
			y: bounds.y,
			width: bounds.width,
			height: bounds.height,
			transparent: true,
			frame: false,
			alwaysOnTop: true,
			skipTaskbar: true,
			focusable: false,
			hasShadow: false,
			type: "toolbar",
			fullscreenable: false,
			webPreferences: {
				nodeIntegration: false,
			},
		});

		cursorHideWindow.on("closed", () => {
			cursorHideWindow = null;
		});

		// On macOS, keep this overlay above fullscreen apps/spaces so cursor:none actually applies.
		cursorHideWindow.setAlwaysOnTop(true, "screen-saver", 1);
		cursorHideWindow.setVisibleOnAllWorkspaces(true, {
			visibleOnFullScreen: true,
			skipTransformProcessType: true,
		});
		cursorHideWindow.showInactive();
		cursorHideWindow.setIgnoreMouseEvents(true, { forward: true });
		cursorHideWindow.loadURL(`data:text/html,
			<html>
				<head>
					<style>
						* { cursor: none !important; }
						html, body {
							margin: 0;
							padding: 0;
							background: transparent;
							overflow: hidden;
						}
					</style>
				</head>
				<body></body>
			</html>
		`);

		return { success: true };
	});

	ipcMain.handle("show-system-cursor", () => {
		closeCursorHideWindow();
		return { success: true };
	});

	ipcMain.handle("get-cursor-telemetry", async (_, videoPath?: string) => {
		const targetVideoPath = videoPath ?? currentVideoPath;
		if (!targetVideoPath) {
			return { success: true, samples: [] };
		}

		const telemetryPath = `${targetVideoPath}.cursor.json`;
		try {
			const content = await fs.readFile(telemetryPath, "utf-8");
			const parsed = JSON.parse(content);
			const rawSamples = Array.isArray(parsed)
				? parsed
				: Array.isArray(parsed?.samples)
					? parsed.samples
					: [];

			const samples: CursorTelemetryPoint[] = rawSamples
				.filter((sample: unknown) => Boolean(sample && typeof sample === "object"))
				.map((sample: unknown) => {
					const point = sample as Partial<CursorTelemetryPoint>;
					return {
						timeMs:
							typeof point.timeMs === "number" && Number.isFinite(point.timeMs)
								? Math.max(0, point.timeMs)
								: 0,
						cx:
							typeof point.cx === "number" && Number.isFinite(point.cx)
								? clamp(point.cx, 0, 1)
								: 0.5,
						cy:
							typeof point.cy === "number" && Number.isFinite(point.cy)
								? clamp(point.cy, 0, 1)
								: 0.5,
					};
				})
				.sort((a: CursorTelemetryPoint, b: CursorTelemetryPoint) => a.timeMs - b.timeMs);

			return { success: true, samples };
		} catch (error) {
			const nodeError = error as NodeJS.ErrnoException;
			if (nodeError.code === "ENOENT") {
				return { success: true, samples: [] };
			}
			console.error("Failed to load cursor telemetry:", error);
			return {
				success: false,
				message: "Failed to load cursor telemetry",
				error: String(error),
				samples: [],
			};
		}
	});

	ipcMain.handle("get-keyboard-telemetry", async (_, videoPath?: string) => {
		const targetVideoPath = videoPath ?? currentVideoPath;
		if (!targetVideoPath) {
			return { success: true, events: [] };
		}

		const telemetryPath = `${targetVideoPath}.keyboard.json`;
		try {
			const content = await fs.readFile(telemetryPath, "utf-8");
			const parsed = JSON.parse(content);
			const rawEvents = Array.isArray(parsed)
				? parsed
				: Array.isArray(parsed?.events)
					? parsed.events
					: [];

			const events: KeyboardTelemetryEvent[] = rawEvents
				.filter((event: unknown) => Boolean(event && typeof event === "object"))
				.map((event: unknown) => {
					const value = event as Partial<KeyboardTelemetryEvent>;
					return {
						timeMs:
							typeof value.timeMs === "number" && Number.isFinite(value.timeMs)
								? Math.max(0, Math.round(value.timeMs))
								: 0,
						keyType: value.keyType === "space" || value.keyType === "enter" ? value.keyType : "key",
					};
				})
				.sort((a: KeyboardTelemetryEvent, b: KeyboardTelemetryEvent) => a.timeMs - b.timeMs);

			return { success: true, events };
		} catch (error) {
			const nodeError = error as NodeJS.ErrnoException;
			if (nodeError.code === "ENOENT") {
				return { success: true, events: [] };
			}
			console.error("Failed to load keyboard telemetry:", error);
			return {
				success: false,
				message: "Failed to load keyboard telemetry",
				error: String(error),
				events: [],
			};
		}
	});

	ipcMain.handle("get-mouse-telemetry", async (_, videoPath?: string) => {
		const targetVideoPath = videoPath ?? currentVideoPath;
		if (!targetVideoPath) {
			return { success: true, events: [] };
		}

		const telemetryPath = `${targetVideoPath}.mouse.json`;
		try {
			const content = await fs.readFile(telemetryPath, "utf-8");
			const parsed = JSON.parse(content);
			const rawEvents = Array.isArray(parsed)
				? parsed
				: Array.isArray(parsed?.events)
					? parsed.events
					: [];

			const events: MouseClickTelemetryEvent[] = rawEvents
				.filter((event: unknown) => Boolean(event && typeof event === "object"))
				.map((event: unknown) => {
					const value = event as Partial<MouseClickTelemetryEvent>;
					return {
						timeMs:
							typeof value.timeMs === "number" && Number.isFinite(value.timeMs)
								? Math.max(0, Math.round(value.timeMs))
								: 0,
						button: value.button === "right" || value.button === "other" ? value.button : "left",
					};
				})
				.sort((a: MouseClickTelemetryEvent, b: MouseClickTelemetryEvent) => a.timeMs - b.timeMs);

			return { success: true, events };
		} catch (error) {
			const nodeError = error as NodeJS.ErrnoException;
			if (nodeError.code === "ENOENT") {
				return { success: true, events: [] };
			}
			console.error("Failed to load mouse telemetry:", error);
			return {
				success: false,
				message: "Failed to load mouse telemetry",
				error: String(error),
				events: [],
			};
		}
	});

	ipcMain.handle("open-external-url", async (_, url: string) => {
		try {
			await shell.openExternal(url);
			return { success: true };
		} catch (error) {
			console.error("Failed to open URL:", error);
			return { success: false, error: String(error) };
		}
	});

	// Return base path for assets so renderer can resolve file:// paths in production
	ipcMain.handle("get-asset-base-path", () => {
		try {
			if (app.isPackaged) {
				return path.join(process.resourcesPath, "assets");
			}
			return path.join(app.getAppPath(), "public", "assets");
		} catch (err) {
			console.error("Failed to resolve asset base path:", err);
			return null;
		}
	});

	ipcMain.handle("list-wallpapers", async () => {
		try {
			const wallpapersDir = app.isPackaged
				? path.join(process.resourcesPath, "assets", "wallpapers")
				: path.join(app.getAppPath(), "public", "wallpapers");

			const entries = await fs.readdir(wallpapersDir, { withFileTypes: true });
			const names = entries
				.filter((entry) => entry.isFile())
				.map((entry) => entry.name)
				.filter((name) => /\.(jpg|jpeg|png|webp)$/i.test(name))
				.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));

			return {
				success: true,
				relativePaths: names.map((name) => `wallpapers/${name}`),
			};
		} catch (error) {
			console.error("Failed to list wallpapers:", error);
			return {
				success: false,
				relativePaths: [] as string[],
				error: String(error),
			};
		}
	});

	ipcMain.handle("save-exported-video", async (_, videoData: ArrayBuffer, fileName: string) => {
		try {
			// Determine file type from extension
			const isGif = fileName.toLowerCase().endsWith(".gif");
			const filters = isGif
				? [{ name: "GIF Image", extensions: ["gif"] }]
				: [{ name: "MP4 Video", extensions: ["mp4"] }];

			const result = await dialog.showSaveDialog({
				title: isGif ? "Save Exported GIF" : "Save Exported Video",
				defaultPath: path.join(app.getPath("downloads"), fileName),
				filters,
				properties: ["createDirectory", "showOverwriteConfirmation"],
			});

			if (result.canceled || !result.filePath) {
				return {
					success: false,
					canceled: true,
					message: "Export canceled",
				};
			}

			await fs.writeFile(result.filePath, Buffer.from(videoData));

			return {
				success: true,
				path: result.filePath,
				message: "Video exported successfully",
			};
		} catch (error) {
			console.error("Failed to save exported video:", error);
			return {
				success: false,
				message: "Failed to save exported video",
				error: String(error),
			};
		}
	});

	ipcMain.handle("open-video-file-picker", async () => {
		try {
			const result = await dialog.showOpenDialog({
				title: "Select Video File",
				defaultPath: RECORDINGS_DIR,
				filters: [
					{ name: "Video Files", extensions: ["webm", "mp4", "mov", "avi", "mkv"] },
					{ name: "All Files", extensions: ["*"] },
				],
				properties: ["openFile"],
			});

			if (result.canceled || result.filePaths.length === 0) {
				return { success: false, canceled: true };
			}

			currentProjectPath = null;
			return {
				success: true,
				path: result.filePaths[0],
			};
		} catch (error) {
			console.error("Failed to open file picker:", error);
			return {
				success: false,
				message: "Failed to open file picker",
				error: String(error),
			};
		}
	});

	ipcMain.handle("reveal-in-folder", async (_, filePath: string) => {
		try {
			// shell.showItemInFolder doesn't return a value, it throws on error
			shell.showItemInFolder(filePath);
			return { success: true };
		} catch (error) {
			console.error(`Error revealing item in folder: ${filePath}`, error);
			// Fallback to open the directory if revealing the item fails
			// This might happen if the file was moved or deleted after export,
			// or if the path is somehow invalid for showItemInFolder
			try {
				const openPathResult = await shell.openPath(path.dirname(filePath));
				if (openPathResult) {
					// openPath returned an error message
					return { success: false, error: openPathResult };
				}
				return { success: true, message: "Could not reveal item, but opened directory." };
			} catch (openError) {
				console.error(`Error opening directory: ${path.dirname(filePath)}`, openError);
				return { success: false, error: String(error) };
			}
		}
	});

	let currentVideoPath: string | null = null;
	ipcMain.handle(
		"save-project-file",
		async (_, projectData: unknown, suggestedName?: string, existingProjectPath?: string) => {
			try {
				const trustedExistingProjectPath = isTrustedProjectPath(existingProjectPath)
					? existingProjectPath
					: null;

				if (trustedExistingProjectPath) {
					await fs.writeFile(
						trustedExistingProjectPath,
						JSON.stringify(projectData, null, 2),
						"utf-8",
					);
					currentProjectPath = trustedExistingProjectPath;
					return {
						success: true,
						path: trustedExistingProjectPath,
						message: "Project saved successfully",
					};
				}

				const safeName = (suggestedName || `project-${Date.now()}`).replace(/[^a-zA-Z0-9-_]/g, "_");
				const defaultName = safeName.endsWith(`.${PROJECT_FILE_EXTENSION}`)
					? safeName
					: `${safeName}.${PROJECT_FILE_EXTENSION}`;

				const result = await dialog.showSaveDialog({
					title: "Save OpenScreen Project",
					defaultPath: path.join(RECORDINGS_DIR, defaultName),
					filters: [
						{ name: "OpenScreen Project", extensions: [PROJECT_FILE_EXTENSION] },
						{ name: "JSON", extensions: ["json"] },
					],
					properties: ["createDirectory", "showOverwriteConfirmation"],
				});

				if (result.canceled || !result.filePath) {
					return {
						success: false,
						canceled: true,
						message: "Save project canceled",
					};
				}

				await fs.writeFile(result.filePath, JSON.stringify(projectData, null, 2), "utf-8");
				currentProjectPath = result.filePath;

				return {
					success: true,
					path: result.filePath,
					message: "Project saved successfully",
				};
			} catch (error) {
				console.error("Failed to save project file:", error);
				return {
					success: false,
					message: "Failed to save project file",
					error: String(error),
				};
			}
		},
	);

	ipcMain.handle("load-project-file", async () => {
		try {
			const result = await dialog.showOpenDialog({
				title: "Open OpenScreen Project",
				defaultPath: RECORDINGS_DIR,
				filters: [
					{ name: "OpenScreen Project", extensions: [PROJECT_FILE_EXTENSION] },
					{ name: "JSON", extensions: ["json"] },
					{ name: "All Files", extensions: ["*"] },
				],
				properties: ["openFile"],
			});

			if (result.canceled || result.filePaths.length === 0) {
				return { success: false, canceled: true, message: "Open project canceled" };
			}

			const filePath = result.filePaths[0];
			const content = await fs.readFile(filePath, "utf-8");
			const project = JSON.parse(content);
			currentProjectPath = filePath;
			if (project && typeof project === "object" && typeof project.videoPath === "string") {
				currentVideoPath = project.videoPath;
			}

			return {
				success: true,
				path: filePath,
				project,
			};
		} catch (error) {
			console.error("Failed to load project file:", error);
			return {
				success: false,
				message: "Failed to load project file",
				error: String(error),
			};
		}
	});

	ipcMain.handle("load-current-project-file", async () => {
		try {
			if (!currentProjectPath) {
				return { success: false, message: "No active project" };
			}

			const content = await fs.readFile(currentProjectPath, "utf-8");
			const project = JSON.parse(content);
			if (project && typeof project === "object" && typeof project.videoPath === "string") {
				currentVideoPath = project.videoPath;
			}
			return {
				success: true,
				path: currentProjectPath,
				project,
			};
		} catch (error) {
			console.error("Failed to load current project file:", error);
			return {
				success: false,
				message: "Failed to load current project file",
				error: String(error),
			};
		}
	});
	ipcMain.handle("set-current-video-path", (_, path: string) => {
		currentVideoPath = path;
		currentProjectPath = null;
		return { success: true };
	});

	ipcMain.handle("get-current-video-path", () => {
		return currentVideoPath ? { success: true, path: currentVideoPath } : { success: false };
	});

	ipcMain.handle("clear-current-video-path", () => {
		currentVideoPath = null;
		return { success: true };
	});

	ipcMain.handle("get-platform", () => {
		return process.platform;
	});

	ipcMain.handle("get-shortcuts", async () => {
		try {
			const data = await fs.readFile(SHORTCUTS_FILE, "utf-8");
			return JSON.parse(data);
		} catch {
			return null;
		}
	});

	ipcMain.handle("save-shortcuts", async (_, shortcuts: unknown) => {
		try {
			await fs.writeFile(SHORTCUTS_FILE, JSON.stringify(shortcuts, null, 2), "utf-8");
			return { success: true };
		} catch (error) {
			console.error("Failed to save shortcuts:", error);
			return { success: false, error: String(error) };
		}
	});
}
