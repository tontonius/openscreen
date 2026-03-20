export type ZoomDepth = 1 | 2 | 3 | 4 | 5 | 6;

export interface ZoomFocus {
	cx: number; // normalized horizontal center (0-1)
	cy: number; // normalized vertical center (0-1)
}

export interface ZoomRegion {
	id: string;
	startMs: number;
	endMs: number;
	depth: ZoomDepth;
	focus: ZoomFocus;
}

export interface CursorTelemetryPoint {
	timeMs: number;
	cx: number;
	cy: number;
}

export type KeyboardTelemetryKeyType = "key" | "space" | "enter";

export interface KeyboardTelemetryEvent {
	timeMs: number;
	keyType: KeyboardTelemetryKeyType;
}

export interface MouseClickTelemetryEvent {
	timeMs: number;
	button: "left" | "right" | "other";
}

export type CursorOverlayPreset = "classic" | "dark" | "highlight";
export type CursorOverlayType = "macos" | "touch";
export type KeyboardSoundPack = "k1" | "k2" | "k3" | "k4" | "k5" | "k6";

export interface CursorOverlaySettings {
	enabled: boolean;
	preset: CursorOverlayPreset;
	cursorType: CursorOverlayType;
	size: number;
	smoothing: number;
	playKeyboardSounds: boolean;
	keyboardSoundPack: KeyboardSoundPack;
	cursorOffWhenTyping: boolean;
	cursorTypingHideDelayMs: number;
	alwaysUseDefaultCursor: boolean;
	hideWhenIdle: boolean;
	idleHideDelayMs: number;
	loopToStart: boolean;
	loopDurationMs: number;
	rotateWhileMoving: boolean;
	rotationMoveThreshold: number;
	rotationFullTiltSpeed: number;
	rotationFollowStrength: number;
	rotationDamping: number;
	rotationCoastDamping: number;
	rotationTipStartIntensity: number;
	rotationTipMaxDeg: number;
	stopAtEnd: boolean;
	stopAtEndMs: number;
	removeShakes: boolean;
	shakeThreshold: number;
	optimizeCursorTypes: boolean;
}

export const DEFAULT_CURSOR_OVERLAY_SETTINGS: CursorOverlaySettings = {
	enabled: true,
	preset: "classic",
	cursorType: "macos",
	size: 34,
	smoothing: 0.55,
	playKeyboardSounds: true,
	keyboardSoundPack: "k1",
	cursorOffWhenTyping: true,
	cursorTypingHideDelayMs: 810,
	alwaysUseDefaultCursor: false,
	hideWhenIdle: true,
	idleHideDelayMs: 1400,
	loopToStart: false,
	loopDurationMs: 600,
	rotateWhileMoving: false,
	rotationMoveThreshold: 0.215,
	rotationFullTiltSpeed: 1.0,
	rotationFollowStrength: 30,
	rotationDamping: 15.8,
	rotationCoastDamping: 0.5,
	rotationTipStartIntensity: 0.7,
	rotationTipMaxDeg: 48,
	stopAtEnd: false,
	stopAtEndMs: 300,
	removeShakes: true,
	shakeThreshold: 0.0018,
	optimizeCursorTypes: true,
};

export interface TrimRegion {
	id: string;
	startMs: number;
	endMs: number;
}

export type AnnotationType = "text" | "image" | "figure";

export type ArrowDirection =
	| "up"
	| "down"
	| "left"
	| "right"
	| "up-right"
	| "up-left"
	| "down-right"
	| "down-left";

export interface FigureData {
	arrowDirection: ArrowDirection;
	color: string;
	strokeWidth: number;
}

export interface AnnotationPosition {
	x: number;
	y: number;
}

export interface AnnotationSize {
	width: number;
	height: number;
}

export interface AnnotationTextStyle {
	color: string;
	backgroundColor: string;
	fontSize: number; // pixels
	fontFamily: string;
	fontWeight: "normal" | "bold";
	fontStyle: "normal" | "italic";
	textDecoration: "none" | "underline";
	textAlign: "left" | "center" | "right";
}

export interface AnnotationRegion {
	id: string;
	startMs: number;
	endMs: number;
	type: AnnotationType;
	content: string; // Legacy - still used for current type
	textContent?: string; // Separate storage for text
	imageContent?: string; // Separate storage for image data URL
	position: AnnotationPosition;
	size: AnnotationSize;
	style: AnnotationTextStyle;
	zIndex: number;
	figureData?: FigureData;
}

export const DEFAULT_ANNOTATION_POSITION: AnnotationPosition = {
	x: 50,
	y: 50,
};

export const DEFAULT_ANNOTATION_SIZE: AnnotationSize = {
	width: 30,
	height: 20,
};

export const DEFAULT_ANNOTATION_STYLE: AnnotationTextStyle = {
	color: "#ffffff",
	backgroundColor: "transparent",
	fontSize: 32,
	fontFamily: "Inter",
	fontWeight: "bold",
	fontStyle: "normal",
	textDecoration: "none",
	textAlign: "center",
};

export const DEFAULT_FIGURE_DATA: FigureData = {
	arrowDirection: "right",
	color: "#34B27B",
	strokeWidth: 4,
};

export interface CropRegion {
	x: number;
	y: number;
	width: number;
	height: number;
}

export const DEFAULT_CROP_REGION: CropRegion = {
	x: 0,
	y: 0,
	width: 1,
	height: 1,
};

export type PlaybackSpeed = 0.25 | 0.5 | 0.75 | 1.25 | 1.5 | 1.75 | 2 | 4 | 8 | 16;

export interface SpeedRegion {
	id: string;
	startMs: number;
	endMs: number;
	speed: PlaybackSpeed;
}

export const SPEED_OPTIONS: Array<{ speed: PlaybackSpeed; label: string }> = [
	{ speed: 0.25, label: "0.25×" },
	{ speed: 0.5, label: "0.5×" },
	{ speed: 0.75, label: "0.75×" },
	{ speed: 1.25, label: "1.25×" },
	{ speed: 1.5, label: "1.5×" },
	{ speed: 1.75, label: "1.75×" },
	{ speed: 2, label: "2×" },
	{ speed: 4, label: "4×" },
	{ speed: 8, label: "8×" },
	{ speed: 16, label: "16×" },
];

export const DEFAULT_PLAYBACK_SPEED: PlaybackSpeed = 1.5;

export const ZOOM_DEPTH_SCALES: Record<ZoomDepth, number> = {
	1: 1.25,
	2: 1.5,
	3: 1.8,
	4: 2.2,
	5: 3.5,
	6: 5.0,
};

export const DEFAULT_ZOOM_DEPTH: ZoomDepth = 3;

export function clampFocusToDepth(focus: ZoomFocus, _depth: ZoomDepth): ZoomFocus {
	return {
		cx: clamp(focus.cx, 0, 1),
		cy: clamp(focus.cy, 0, 1),
	};
}

function clamp(value: number, min: number, max: number) {
	if (Number.isNaN(value)) return (min + max) / 2;
	return Math.min(max, Math.max(min, value));
}
