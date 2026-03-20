/// <reference types="vite/client" />
/// <reference types="../electron/electron-env" />

interface ProcessedDesktopSource {
	id: string;
	name: string;
	display_id: string;
	thumbnail: string | null;
	appIcon: string | null;
}

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

interface Window {
	electronAPI: {
		getSources: (opts: Electron.SourcesOptions) => Promise<ProcessedDesktopSource[]>;
		switchToEditor: () => Promise<void>;
		openSourceSelector: () => Promise<void>;
		selectSource: (source: any) => Promise<any>;
		getSelectedSource: () => Promise<any>;
		storeRecordedVideo: (
			videoData: ArrayBuffer,
			fileName: string,
		) => Promise<{
			success: boolean;
			path?: string;
			message: string;
			error?: string;
		}>;
		getRecordedVideoPath: () => Promise<{
			success: boolean;
			path?: string;
			message?: string;
			error?: string;
		}>;
		getAssetBasePath: () => Promise<string | null>;
		listWallpapers: () => Promise<{
			success: boolean;
			relativePaths: string[];
			error?: string;
		}>;
		setRecordingState: (recording: boolean) => Promise<void>;
		startNativeScreenRecording: (options?: {
			source?: { id?: string; display_id?: string };
			cursorMode?: "always" | "never";
			frameRate?: number;
		}) => Promise<{
			success: boolean;
			path?: string;
			width?: number;
			height?: number;
			frameRate?: number;
			hasMicrophoneAudio?: boolean;
			sourceFrameX?: number;
			sourceFrameY?: number;
			sourceFrameWidth?: number;
			sourceFrameHeight?: number;
			code?: string;
			message?: string;
		}>;
		stopNativeScreenRecording: () => Promise<{
			success: boolean;
			path?: string;
			message?: string;
			metadata?: {
				frameRate: number;
				width: number;
				height: number;
				mimeType: string;
				capturedAt: number;
				systemCursorMode: "always" | "never";
				hasMicrophoneAudio: boolean;
				keyboardEvents: Array<{ timeMs: number; keyType: "key" | "space" | "enter" }>;
				mouseClickEvents: Array<{ timeMs: number; button: "left" | "right" | "other" }>;
			};
		}>;
		hideSystemCursor: () => Promise<{ success: boolean }>;
		showSystemCursor: () => Promise<{ success: boolean }>;
		getCursorTelemetry: (videoPath?: string) => Promise<{
			success: boolean;
			samples: CursorTelemetryPoint[];
			message?: string;
			error?: string;
		}>;
		getKeyboardTelemetry: (videoPath?: string) => Promise<{
			success: boolean;
			events: KeyboardTelemetryEvent[];
			message?: string;
			error?: string;
		}>;
		getMouseTelemetry: (videoPath?: string) => Promise<{
			success: boolean;
			events: MouseClickTelemetryEvent[];
			message?: string;
			error?: string;
		}>;
		onStopRecordingFromTray: (callback: () => void) => () => void;
		openExternalUrl: (url: string) => Promise<{ success: boolean; error?: string }>;
		saveExportedVideo: (
			videoData: ArrayBuffer,
			fileName: string,
		) => Promise<{
			success: boolean;
			path?: string;
			message?: string;
			canceled?: boolean;
		}>;
		openVideoFilePicker: () => Promise<{ success: boolean; path?: string; canceled?: boolean }>;
		setCurrentVideoPath: (path: string) => Promise<{ success: boolean }>;
		getCurrentVideoPath: () => Promise<{ success: boolean; path?: string }>;
		clearCurrentVideoPath: () => Promise<{ success: boolean }>;
		saveProjectFile: (
			projectData: unknown,
			suggestedName?: string,
			existingProjectPath?: string,
		) => Promise<{
			success: boolean;
			path?: string;
			message?: string;
			canceled?: boolean;
			error?: string;
		}>;
		loadProjectFile: () => Promise<{
			success: boolean;
			path?: string;
			project?: unknown;
			message?: string;
			canceled?: boolean;
			error?: string;
		}>;
		loadCurrentProjectFile: () => Promise<{
			success: boolean;
			path?: string;
			project?: unknown;
			message?: string;
			canceled?: boolean;
			error?: string;
		}>;
		onMenuLoadProject: (callback: () => void) => () => void;
		onMenuSaveProject: (callback: () => void) => () => void;
		onMenuSaveProjectAs: (callback: () => void) => () => void;
		setMicrophoneExpanded: (expanded: boolean) => void;
	};
}
