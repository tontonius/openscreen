import type {
	CropRegion,
	CursorOverlayPreset,
	CursorOverlaySettings,
	CursorOverlayType,
	CursorTelemetryPoint,
} from "./types";
import { DEFAULT_CURSOR_OVERLAY_SETTINGS } from "./types";

const CURSOR_PATH = "M2 1 L2 28 L9 21 L14 34 L19 32 L14 19 L24 19 Z";
const CURSOR_VIEWBOX_WIDTH = 28;
const CURSOR_VIEWBOX_HEIGHT = 36;
const CURSOR_HOTSPOT_X = 2;
const CURSOR_HOTSPOT_Y = 1;
const CURSOR_REST_DIRECTION_DEG = -135;

function normalizeAngleDeg(angle: number): number {
	let normalized = angle % 360;
	if (normalized <= -180) normalized += 360;
	if (normalized > 180) normalized -= 360;
	return normalized;
}

function shortestAngleDeltaDeg(fromDeg: number, toDeg: number): number {
	return normalizeAngleDeg(toDeg - fromDeg);
}

export const CURSOR_PRESET_OPTIONS: Array<{ value: CursorOverlayPreset; label: string }> = [
	{ value: "classic", label: "Classic" },
	{ value: "dark", label: "Dark" },
	{ value: "highlight", label: "Highlight" },
];

export const CURSOR_TYPE_OPTIONS: Array<{ value: CursorOverlayType; label: string }> = [
	{ value: "macos", label: "macOS" },
	{ value: "touch", label: "Touch" },
];

export interface CursorStagePoint {
	x: number;
	y: number;
}

export interface CursorMaskRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface CursorStageSize {
	width: number;
	height: number;
}

export interface CursorSmoothingState {
	timeMs: number;
	cx: number;
	cy: number;
	lastMoveTimeMs: number;
	rotationDeg?: number;
	rotationVelocityDegPerSec?: number;
}

export interface CursorResolvedSample {
	point: CursorTelemetryPoint;
	state: CursorSmoothingState;
	visible: boolean;
	rotationDeg: number;
}

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

export function normalizeCursorOverlaySettings(
	candidate: Partial<CursorOverlaySettings> | undefined,
): CursorOverlaySettings {
	return {
		enabled:
			typeof candidate?.enabled === "boolean"
				? candidate.enabled
				: DEFAULT_CURSOR_OVERLAY_SETTINGS.enabled,
		preset:
			candidate?.preset === "classic" ||
			candidate?.preset === "dark" ||
			candidate?.preset === "highlight"
				? candidate.preset
				: DEFAULT_CURSOR_OVERLAY_SETTINGS.preset,
		cursorType:
			candidate?.cursorType === "touch" || candidate?.cursorType === "macos"
				? candidate.cursorType
				: DEFAULT_CURSOR_OVERLAY_SETTINGS.cursorType,
		size:
			typeof candidate?.size === "number" && Number.isFinite(candidate.size)
				? clamp(candidate.size, 20, 96)
				: DEFAULT_CURSOR_OVERLAY_SETTINGS.size,
		smoothing:
			typeof candidate?.smoothing === "number" && Number.isFinite(candidate.smoothing)
				? clamp(candidate.smoothing, 0, 1)
				: DEFAULT_CURSOR_OVERLAY_SETTINGS.smoothing,
		playKeyboardSounds:
			typeof candidate?.playKeyboardSounds === "boolean"
				? candidate.playKeyboardSounds
				: DEFAULT_CURSOR_OVERLAY_SETTINGS.playKeyboardSounds,
		keyboardSoundPack:
			candidate?.keyboardSoundPack === "k1" ||
			candidate?.keyboardSoundPack === "k2" ||
			candidate?.keyboardSoundPack === "k3" ||
			candidate?.keyboardSoundPack === "k4" ||
			candidate?.keyboardSoundPack === "k5" ||
			candidate?.keyboardSoundPack === "k6"
				? candidate.keyboardSoundPack
				: DEFAULT_CURSOR_OVERLAY_SETTINGS.keyboardSoundPack,
		cursorOffWhenTyping:
			typeof candidate?.cursorOffWhenTyping === "boolean"
				? candidate.cursorOffWhenTyping
				: DEFAULT_CURSOR_OVERLAY_SETTINGS.cursorOffWhenTyping,
		cursorTypingHideDelayMs:
			typeof candidate?.cursorTypingHideDelayMs === "number" &&
			Number.isFinite(candidate.cursorTypingHideDelayMs)
				? clamp(candidate.cursorTypingHideDelayMs, 150, 3000)
				: DEFAULT_CURSOR_OVERLAY_SETTINGS.cursorTypingHideDelayMs,
		alwaysUseDefaultCursor:
			typeof candidate?.alwaysUseDefaultCursor === "boolean"
				? candidate.alwaysUseDefaultCursor
				: DEFAULT_CURSOR_OVERLAY_SETTINGS.alwaysUseDefaultCursor,
		hideWhenIdle:
			typeof candidate?.hideWhenIdle === "boolean"
				? candidate.hideWhenIdle
				: DEFAULT_CURSOR_OVERLAY_SETTINGS.hideWhenIdle,
		idleHideDelayMs:
			typeof candidate?.idleHideDelayMs === "number" && Number.isFinite(candidate.idleHideDelayMs)
				? clamp(candidate.idleHideDelayMs, 200, 10_000)
				: DEFAULT_CURSOR_OVERLAY_SETTINGS.idleHideDelayMs,
		loopToStart:
			typeof candidate?.loopToStart === "boolean"
				? candidate.loopToStart
				: DEFAULT_CURSOR_OVERLAY_SETTINGS.loopToStart,
		loopDurationMs:
			typeof candidate?.loopDurationMs === "number" && Number.isFinite(candidate.loopDurationMs)
				? clamp(candidate.loopDurationMs, 120, 3000)
				: DEFAULT_CURSOR_OVERLAY_SETTINGS.loopDurationMs,
		rotateWhileMoving:
			typeof candidate?.rotateWhileMoving === "boolean"
				? candidate.rotateWhileMoving
				: DEFAULT_CURSOR_OVERLAY_SETTINGS.rotateWhileMoving,
		rotationMoveThreshold:
			typeof candidate?.rotationMoveThreshold === "number" &&
			Number.isFinite(candidate.rotationMoveThreshold)
				? clamp(candidate.rotationMoveThreshold, 0.005, 0.4)
				: DEFAULT_CURSOR_OVERLAY_SETTINGS.rotationMoveThreshold,
		rotationFullTiltSpeed:
			typeof candidate?.rotationFullTiltSpeed === "number" &&
			Number.isFinite(candidate.rotationFullTiltSpeed)
				? clamp(candidate.rotationFullTiltSpeed, 0.06, 3)
				: DEFAULT_CURSOR_OVERLAY_SETTINGS.rotationFullTiltSpeed,
		rotationFollowStrength:
			typeof candidate?.rotationFollowStrength === "number" &&
			Number.isFinite(candidate.rotationFollowStrength)
				? clamp(candidate.rotationFollowStrength, 2, 80)
				: DEFAULT_CURSOR_OVERLAY_SETTINGS.rotationFollowStrength,
		rotationDamping:
			typeof candidate?.rotationDamping === "number" && Number.isFinite(candidate.rotationDamping)
				? clamp(candidate.rotationDamping, 0.5, 30)
				: DEFAULT_CURSOR_OVERLAY_SETTINGS.rotationDamping,
		rotationCoastDamping:
			typeof candidate?.rotationCoastDamping === "number" &&
			Number.isFinite(candidate.rotationCoastDamping)
				? clamp(candidate.rotationCoastDamping, 0.5, 40)
				: DEFAULT_CURSOR_OVERLAY_SETTINGS.rotationCoastDamping,
		rotationTipStartIntensity:
			typeof candidate?.rotationTipStartIntensity === "number" &&
			Number.isFinite(candidate.rotationTipStartIntensity)
				? clamp(candidate.rotationTipStartIntensity, 0.1, 0.98)
				: DEFAULT_CURSOR_OVERLAY_SETTINGS.rotationTipStartIntensity,
		rotationTipMaxDeg:
			typeof candidate?.rotationTipMaxDeg === "number" &&
			Number.isFinite(candidate.rotationTipMaxDeg)
				? clamp(candidate.rotationTipMaxDeg, 0, 120)
				: DEFAULT_CURSOR_OVERLAY_SETTINGS.rotationTipMaxDeg,
		stopAtEnd:
			typeof candidate?.stopAtEnd === "boolean"
				? candidate.stopAtEnd
				: DEFAULT_CURSOR_OVERLAY_SETTINGS.stopAtEnd,
		stopAtEndMs:
			typeof candidate?.stopAtEndMs === "number" && Number.isFinite(candidate.stopAtEndMs)
				? clamp(candidate.stopAtEndMs, 80, 3000)
				: DEFAULT_CURSOR_OVERLAY_SETTINGS.stopAtEndMs,
		removeShakes:
			typeof candidate?.removeShakes === "boolean"
				? candidate.removeShakes
				: DEFAULT_CURSOR_OVERLAY_SETTINGS.removeShakes,
		shakeThreshold:
			typeof candidate?.shakeThreshold === "number" && Number.isFinite(candidate.shakeThreshold)
				? clamp(candidate.shakeThreshold, 0.0003, 0.01)
				: DEFAULT_CURSOR_OVERLAY_SETTINGS.shakeThreshold,
		optimizeCursorTypes:
			typeof candidate?.optimizeCursorTypes === "boolean"
				? candidate.optimizeCursorTypes
				: DEFAULT_CURSOR_OVERLAY_SETTINGS.optimizeCursorTypes,
	};
}

export function interpolateCursorPosition(
	samples: CursorTelemetryPoint[],
	timeMs: number,
): CursorTelemetryPoint | null {
	if (samples.length === 0) return null;
	if (samples.length === 1) return samples[0];

	const clampedTime = Math.max(0, timeMs);
	if (clampedTime <= samples[0].timeMs) {
		return samples[0];
	}

	const last = samples[samples.length - 1];
	if (clampedTime >= last.timeMs) {
		return last;
	}

	let low = 0;
	let high = samples.length - 1;
	while (low <= high) {
		const mid = Math.floor((low + high) / 2);
		const sample = samples[mid];
		if (sample.timeMs === clampedTime) {
			return sample;
		}
		if (sample.timeMs < clampedTime) {
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}

	const after = samples[Math.min(low, samples.length - 1)];
	const before = samples[Math.max(0, low - 1)];
	const dt = Math.max(1, after.timeMs - before.timeMs);
	const ratio = clamp((clampedTime - before.timeMs) / dt, 0, 1);

	return {
		timeMs: clampedTime,
		cx: before.cx + (after.cx - before.cx) * ratio,
		cy: before.cy + (after.cy - before.cy) * ratio,
	};
}

export function smoothCursorPosition(
	rawPoint: CursorTelemetryPoint,
	settings: CursorOverlaySettings,
	previous: CursorSmoothingState | null,
): { point: CursorTelemetryPoint; state: CursorSmoothingState } {
	const smoothing = clamp(settings.smoothing, 0, 1);
	if (smoothing <= 0 || !previous) {
		const nextState = {
			timeMs: rawPoint.timeMs,
			cx: rawPoint.cx,
			cy: rawPoint.cy,
			lastMoveTimeMs: rawPoint.timeMs,
			rotationDeg: previous?.rotationDeg ?? 0,
			rotationVelocityDegPerSec: previous?.rotationVelocityDegPerSec ?? 0,
		};
		return { point: rawPoint, state: nextState };
	}

	const dtMs = rawPoint.timeMs - previous.timeMs;
	if (dtMs <= 0 || dtMs > 250) {
		const nextState = {
			timeMs: rawPoint.timeMs,
			cx: rawPoint.cx,
			cy: rawPoint.cy,
			lastMoveTimeMs: rawPoint.timeMs,
			rotationDeg: previous.rotationDeg ?? 0,
			rotationVelocityDegPerSec: previous.rotationVelocityDegPerSec ?? 0,
		};
		return { point: rawPoint, state: nextState };
	}

	const dx = rawPoint.cx - previous.cx;
	const dy = rawPoint.cy - previous.cy;
	const distance = Math.hypot(dx, dy);
	const speed = distance / (dtMs / 1000);
	const speedBoost = clamp(speed / 1.6, 0, 1) * 0.45;
	const baseAlpha = 1 - 0.85 * smoothing;
	const alpha = clamp(baseAlpha + speedBoost, 0.05, 1);

	const cx = previous.cx + dx * alpha;
	const cy = previous.cy + dy * alpha;
	const point = { timeMs: rawPoint.timeMs, cx, cy };
	const state = {
		timeMs: rawPoint.timeMs,
		cx,
		cy,
		lastMoveTimeMs: previous.lastMoveTimeMs,
		rotationDeg: previous.rotationDeg ?? 0,
		rotationVelocityDegPerSec: previous.rotationVelocityDegPerSec ?? 0,
	};

	return { point, state };
}

export function resolveCursorSampleAtTime(params: {
	samples: CursorTelemetryPoint[];
	timeMs: number;
	settings: CursorOverlaySettings;
	previous: CursorSmoothingState | null;
	durationMs?: number;
}): CursorResolvedSample | null {
	const { samples, settings, previous, durationMs } = params;
	if (samples.length === 0) {
		return null;
	}

	let effectiveTime = Math.max(0, params.timeMs);
	if (settings.stopAtEnd && typeof durationMs === "number" && Number.isFinite(durationMs)) {
		effectiveTime = Math.min(effectiveTime, Math.max(0, durationMs - settings.stopAtEndMs));
	}

	let rawPoint = interpolateCursorPosition(samples, effectiveTime);
	if (!rawPoint) return null;

	if (
		settings.loopToStart &&
		typeof durationMs === "number" &&
		Number.isFinite(durationMs) &&
		durationMs > 0
	) {
		const loopStart = Math.max(0, durationMs - settings.loopDurationMs);
		if (effectiveTime >= loopStart && durationMs > loopStart + 1) {
			const first = samples[0];
			const t = clamp((effectiveTime - loopStart) / (durationMs - loopStart), 0, 1);
			rawPoint = {
				timeMs: rawPoint.timeMs,
				cx: rawPoint.cx + (first.cx - rawPoint.cx) * t,
				cy: rawPoint.cy + (first.cy - rawPoint.cy) * t,
			};
		}
	}

	if (settings.removeShakes && previous) {
		const jitterDist = Math.hypot(rawPoint.cx - previous.cx, rawPoint.cy - previous.cy);
		if (jitterDist < settings.shakeThreshold) {
			rawPoint = {
				timeMs: rawPoint.timeMs,
				cx: previous.cx,
				cy: previous.cy,
			};
		}
	}

	const smoothed = smoothCursorPosition(rawPoint, settings, previous);

	let lastMoveTimeMs = previous?.lastMoveTimeMs ?? smoothed.point.timeMs;
	const moveDist = previous
		? Math.hypot(smoothed.point.cx - previous.cx, smoothed.point.cy - previous.cy)
		: 0;
	if (!previous || moveDist >= Math.max(0.0012, settings.shakeThreshold * 1.2)) {
		lastMoveTimeMs = smoothed.point.timeMs;
	}

	const visible =
		!settings.hideWhenIdle || smoothed.point.timeMs - lastMoveTimeMs <= settings.idleHideDelayMs;

	let targetRotationDeg = 0;
	if (settings.rotateWhileMoving && previous) {
		const dx = smoothed.point.cx - previous.cx;
		const dy = smoothed.point.cy - previous.cy;
		const dt = Math.max(1, smoothed.point.timeMs - previous.timeMs);
		const speed = Math.hypot(dx, dy) / (dt / 1000);
		const movingSpeedThreshold = settings.rotationMoveThreshold;
		const fullTiltSpeed = Math.max(movingSpeedThreshold + 0.01, settings.rotationFullTiltSpeed);
		const movementAngleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
		const restToMovementDeg = shortestAngleDeltaDeg(CURSOR_REST_DIRECTION_DEG, movementAngleDeg);
		if (speed > movingSpeedThreshold) {
			const intensity = clamp(
				(speed - movingSpeedThreshold) / (fullTiltSpeed - movingSpeedThreshold),
				0,
				1,
			);
			const easedIntensity = intensity * intensity * (3 - 2 * intensity);
			const tipStart = settings.rotationTipStartIntensity;
			const tipBoostFactor = clamp((intensity - tipStart) / Math.max(0.01, 1 - tipStart), 0, 1);
			const tipBoostDeg =
				Math.sign(restToMovementDeg) *
				tipBoostFactor *
				Math.min(settings.rotationTipMaxDeg, Math.abs(restToMovementDeg) * 0.42);
			targetRotationDeg = restToMovementDeg * easedIntensity + tipBoostDeg;
		}
	}
	const previousRotationDeg = previous?.rotationDeg ?? 0;
	const previousRotationVelocityDegPerSec = previous?.rotationVelocityDegPerSec ?? 0;
	const dtSec = previous
		? clamp((smoothed.point.timeMs - previous.timeMs) / 1000, 1 / 240, 0.12)
		: 1 / 60;
	const isCoastingToRest = settings.rotateWhileMoving && Math.abs(targetRotationDeg) < 0.001;
	const followStrength = settings.rotateWhileMoving
		? isCoastingToRest
			? settings.rotationFollowStrength * 0.8
			: settings.rotationFollowStrength
		: 30;
	const dampingPerSecond = settings.rotateWhileMoving
		? isCoastingToRest
			? settings.rotationCoastDamping
			: settings.rotationDamping
		: 11;
	const accel = (targetRotationDeg - previousRotationDeg) * followStrength;
	const velocityAfterAccel = previousRotationVelocityDegPerSec + accel * dtSec;
	const dampingFactor = Math.exp(-dampingPerSecond * dtSec);
	let rotationVelocityDegPerSec = clamp(velocityAfterAccel * dampingFactor, -540, 540);
	let rotationDeg = clamp(previousRotationDeg + rotationVelocityDegPerSec * dtSec, -170, 170);
	if (isCoastingToRest) {
		const coastDecay = Math.exp(-9 * dtSec);
		rotationDeg *= coastDecay;
		rotationVelocityDegPerSec *= coastDecay;
	}
	const snappedRotationDeg = Math.abs(rotationDeg) < 0.01 ? 0 : rotationDeg;
	const snappedRotationVelocityDegPerSec =
		Math.abs(rotationVelocityDegPerSec) < 0.03 ? 0 : rotationVelocityDegPerSec;

	return {
		point: smoothed.point,
		state: {
			...smoothed.state,
			lastMoveTimeMs,
			rotationDeg: snappedRotationDeg,
			rotationVelocityDegPerSec: snappedRotationVelocityDegPerSec,
		},
		visible,
		rotationDeg: snappedRotationDeg,
	};
}

export function mapCursorToStage(
	point: CursorTelemetryPoint,
	cropRegion: CropRegion,
	maskRect: CursorMaskRect,
): CursorStagePoint | null {
	const cropWidth = Math.max(0.000001, cropRegion.width);
	const cropHeight = Math.max(0.000001, cropRegion.height);
	const relX = (point.cx - cropRegion.x) / cropWidth;
	const relY = (point.cy - cropRegion.y) / cropHeight;

	if (relX < 0 || relX > 1 || relY < 0 || relY > 1) {
		return null;
	}

	return {
		x: maskRect.x + relX * maskRect.width,
		y: maskRect.y + relY * maskRect.height,
	};
}

export function transformPointByZoom(
	point: CursorStagePoint,
	stageSize: CursorStageSize,
	zoomScale: number,
	focusX: number,
	focusY: number,
): CursorStagePoint {
	if (zoomScale === 1) {
		return point;
	}

	const focusStagePxX = focusX * stageSize.width;
	const focusStagePxY = focusY * stageSize.height;
	const stageCenterX = stageSize.width / 2;
	const stageCenterY = stageSize.height / 2;
	const cameraX = stageCenterX - focusStagePxX * zoomScale;
	const cameraY = stageCenterY - focusStagePxY * zoomScale;

	return {
		x: cameraX + point.x * zoomScale,
		y: cameraY + point.y * zoomScale,
	};
}

function getCursorPresetColors(preset: CursorOverlayPreset): {
	fill: string;
	stroke: string;
	shadow: string;
} {
	switch (preset) {
		case "dark":
			return {
				fill: "#0f172a",
				stroke: "#f8fafc",
				shadow: "rgba(0, 0, 0, 0.42)",
			};
		case "highlight":
			return {
				fill: "#34B27B",
				stroke: "#082f1f",
				shadow: "rgba(0, 0, 0, 0.34)",
			};
		case "classic":
		default:
			return {
				fill: "#ffffff",
				stroke: "#0f172a",
				shadow: "rgba(0, 0, 0, 0.36)",
			};
	}
}

export function getCursorSvgPath() {
	return CURSOR_PATH;
}

export function getCursorViewBox() {
	return {
		width: CURSOR_VIEWBOX_WIDTH,
		height: CURSOR_VIEWBOX_HEIGHT,
		hotspotX: CURSOR_HOTSPOT_X,
		hotspotY: CURSOR_HOTSPOT_Y,
	};
}

export function getCursorPresetColorsForSvg(preset: CursorOverlayPreset) {
	return getCursorPresetColors(preset);
}

export function drawCursorOnCanvas(
	ctx: CanvasRenderingContext2D,
	position: CursorStagePoint,
	settings: CursorOverlaySettings,
	rotationDeg: number = 0,
) {
	const cursorType: CursorOverlayType =
		settings.alwaysUseDefaultCursor || settings.cursorType === "macos" ? "macos" : "touch";
	const colors = getCursorPresetColors(settings.preset);

	ctx.save();
	ctx.translate(position.x, position.y);
	ctx.rotate((rotationDeg * Math.PI) / 180);

	if (cursorType === "touch") {
		const radius = settings.size * 0.5;
		ctx.shadowColor = colors.shadow;
		ctx.shadowBlur = 6;
		ctx.shadowOffsetX = 1;
		ctx.shadowOffsetY = 1;
		ctx.fillStyle = colors.fill;
		ctx.strokeStyle = colors.stroke;
		ctx.lineWidth = Math.max(2, settings.size * 0.11);
		ctx.beginPath();
		ctx.arc(0, 0, radius, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();

		ctx.beginPath();
		ctx.fillStyle = colors.stroke;
		ctx.arc(0, 0, radius * 0.35, 0, Math.PI * 2);
		ctx.fill();
		ctx.restore();
		return;
	}

	const scale = settings.size / CURSOR_VIEWBOX_HEIGHT;
	const path = new Path2D(CURSOR_PATH);
	ctx.translate(-CURSOR_HOTSPOT_X * scale, -CURSOR_HOTSPOT_Y * scale);
	ctx.scale(scale, scale);
	ctx.shadowColor = colors.shadow;
	ctx.shadowBlur = 4;
	ctx.shadowOffsetX = 1.2;
	ctx.shadowOffsetY = 1.2;
	ctx.fillStyle = colors.fill;
	ctx.strokeStyle = colors.stroke;
	ctx.lineWidth = 1.7;
	ctx.lineJoin = "round";
	ctx.lineCap = "round";
	ctx.fill(path);
	ctx.stroke(path);
	ctx.restore();
}
