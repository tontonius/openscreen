import {
	Application,
	BlurFilter,
	Container,
	Graphics,
	Sprite,
	Texture,
	VideoSource,
} from "pixi.js";
import type React from "react";
import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";
import { getAssetPath } from "@/lib/assetPath";
import { type AspectRatio, formatAspectRatioForCSS } from "@/utils/aspectRatioUtils";
import { AnnotationOverlay } from "./AnnotationOverlay";
import {
	type CursorSmoothingState,
	getCursorPresetColorsForSvg,
	getCursorSvgPath,
	getCursorViewBox,
	mapCursorToStage,
	normalizeCursorOverlaySettings,
	resolveCursorSampleAtTime,
	transformPointByZoom,
} from "./cursorOverlay";
import { getKeyboardSoundRelativePaths } from "./keyboardSoundPacks";
import { getTypingCursorHideAmountAtTime } from "./keyboardTelemetry";
import { getMouseClickPressAmountAtTime } from "./mouseTelemetry";
import {
	type AnnotationRegion,
	type CursorOverlaySettings,
	type CursorTelemetryPoint,
	DEFAULT_CROP_REGION,
	type KeyboardTelemetryEvent,
	type MouseClickTelemetryEvent,
	type SpeedRegion,
	type TrimRegion,
	ZOOM_DEPTH_SCALES,
	type ZoomDepth,
	type ZoomFocus,
	type ZoomRegion,
} from "./types";
import { DEFAULT_FOCUS, MIN_DELTA, SMOOTHING_FACTOR } from "./videoPlayback/constants";
import { clampFocusToStage as clampFocusToStageUtil } from "./videoPlayback/focusUtils";
import { layoutVideoContent as layoutVideoContentUtil } from "./videoPlayback/layoutUtils";
import { clamp01 } from "./videoPlayback/mathUtils";
import { updateOverlayIndicator } from "./videoPlayback/overlayUtils";
import { createVideoEventHandlers } from "./videoPlayback/videoEventHandlers";
import { findDominantRegion } from "./videoPlayback/zoomRegionUtils";
import { applyZoomTransform } from "./videoPlayback/zoomTransform";

interface VideoPlaybackProps {
	videoPath: string;
	onDurationChange: (duration: number) => void;
	onTimeUpdate: (time: number) => void;
	currentTime: number;
	onPlayStateChange: (playing: boolean) => void;
	onError: (error: string) => void;
	wallpaper?: string;
	zoomRegions: ZoomRegion[];
	selectedZoomId: string | null;
	onSelectZoom: (id: string | null) => void;
	onZoomFocusChange: (id: string, focus: ZoomFocus) => void;
	isPlaying: boolean;
	showShadow?: boolean;
	shadowIntensity?: number;
	showBlur?: boolean;
	motionBlurEnabled?: boolean;
	borderRadius?: number;
	padding?: number;
	cropRegion?: import("./types").CropRegion;
	trimRegions?: TrimRegion[];
	speedRegions?: SpeedRegion[];
	aspectRatio: AspectRatio;
	cursorTelemetry?: CursorTelemetryPoint[];
	keyboardTelemetry?: KeyboardTelemetryEvent[];
	mouseTelemetry?: MouseClickTelemetryEvent[];
	cursorOverlay?: CursorOverlaySettings;
	annotationRegions?: AnnotationRegion[];
	selectedAnnotationId?: string | null;
	onSelectAnnotation?: (id: string | null) => void;
	onAnnotationPositionChange?: (id: string, position: { x: number; y: number }) => void;
	onAnnotationSizeChange?: (id: string, size: { width: number; height: number }) => void;
}

export interface VideoPlaybackRef {
	video: HTMLVideoElement | null;
	app: Application | null;
	videoSprite: Sprite | null;
	videoContainer: Container | null;
	containerRef: React.RefObject<HTMLDivElement>;
	play: () => Promise<void>;
	pause: () => void;
}

const VideoPlayback = forwardRef<VideoPlaybackRef, VideoPlaybackProps>(
	(
		{
			videoPath,
			onDurationChange,
			onTimeUpdate,
			currentTime,
			onPlayStateChange,
			onError,
			wallpaper,
			zoomRegions,
			selectedZoomId,
			onSelectZoom,
			onZoomFocusChange,
			isPlaying,
			showShadow,
			shadowIntensity = 0,
			showBlur,
			motionBlurEnabled = false,
			borderRadius = 0,
			padding = 50,
			cropRegion,
			trimRegions = [],
			speedRegions = [],
			aspectRatio,
			cursorTelemetry = [],
			keyboardTelemetry = [],
			mouseTelemetry = [],
			cursorOverlay,
			annotationRegions = [],
			selectedAnnotationId,
			onSelectAnnotation,
			onAnnotationPositionChange,
			onAnnotationSizeChange,
		},
		ref,
	) => {
		const videoRef = useRef<HTMLVideoElement | null>(null);
		const containerRef = useRef<HTMLDivElement | null>(null);
		const appRef = useRef<Application | null>(null);
		const videoSpriteRef = useRef<Sprite | null>(null);
		const videoContainerRef = useRef<Container | null>(null);
		const cameraContainerRef = useRef<Container | null>(null);
		const timeUpdateAnimationRef = useRef<number | null>(null);
		const [pixiReady, setPixiReady] = useState(false);
		const [videoReady, setVideoReady] = useState(false);
		const overlayRef = useRef<HTMLDivElement | null>(null);
		const focusIndicatorRef = useRef<HTMLDivElement | null>(null);
		const currentTimeRef = useRef(0);
		const zoomRegionsRef = useRef<ZoomRegion[]>([]);
		const selectedZoomIdRef = useRef<string | null>(null);
		const animationStateRef = useRef({
			scale: 1,
			focusX: DEFAULT_FOCUS.cx,
			focusY: DEFAULT_FOCUS.cy,
		});
		const blurFilterRef = useRef<BlurFilter | null>(null);
		const isDraggingFocusRef = useRef(false);
		const stageSizeRef = useRef({ width: 0, height: 0 });
		const videoSizeRef = useRef({ width: 0, height: 0 });
		const baseScaleRef = useRef(1);
		const baseOffsetRef = useRef({ x: 0, y: 0 });
		const baseMaskRef = useRef({ x: 0, y: 0, width: 0, height: 0 });
		const cropBoundsRef = useRef({ startX: 0, endX: 0, startY: 0, endY: 0 });
		const maskGraphicsRef = useRef<Graphics | null>(null);
		const isPlayingRef = useRef(isPlaying);
		const isSeekingRef = useRef(false);
		const allowPlaybackRef = useRef(false);
		const lockedVideoDimensionsRef = useRef<{ width: number; height: number } | null>(null);
		const layoutVideoContentRef = useRef<(() => void) | null>(null);
		const trimRegionsRef = useRef<TrimRegion[]>([]);
		const speedRegionsRef = useRef<SpeedRegion[]>([]);
		const motionBlurEnabledRef = useRef(motionBlurEnabled);
		const videoReadyRafRef = useRef<number | null>(null);
		const cursorSmoothingRef = useRef<CursorSmoothingState | null>(null);
		const keyboardAudioAssetsRef = useRef<{ key: string; space: string; enter: string } | null>(
			null,
		);
		const keyboardEventCursorRef = useRef(0);
		const activeKeyboardAudioRef = useRef<HTMLAudioElement | null>(null);
		const mouseClickAudioRef = useRef<string | null>(null);
		const mouseClickEventCursorRef = useRef(0);
		const activeMouseClickAudioRef = useRef<HTMLAudioElement | null>(null);

		const resolvedCursorOverlay = useMemo(
			() => normalizeCursorOverlaySettings(cursorOverlay),
			[cursorOverlay],
		);

		const clampFocusToStage = useCallback((focus: ZoomFocus, depth: ZoomDepth) => {
			return clampFocusToStageUtil(focus, depth, stageSizeRef.current);
		}, []);

		const updateOverlayForRegion = useCallback(
			(region: ZoomRegion | null, focusOverride?: ZoomFocus) => {
				const overlayEl = overlayRef.current;
				const indicatorEl = focusIndicatorRef.current;

				if (!overlayEl || !indicatorEl) {
					return;
				}

				// Update stage size from overlay dimensions
				const stageWidth = overlayEl.clientWidth;
				const stageHeight = overlayEl.clientHeight;
				if (stageWidth && stageHeight) {
					stageSizeRef.current = { width: stageWidth, height: stageHeight };
				}

				updateOverlayIndicator({
					overlayEl,
					indicatorEl,
					region,
					focusOverride,
					videoSize: videoSizeRef.current,
					baseScale: baseScaleRef.current,
					isPlaying: isPlayingRef.current,
				});
			},
			[],
		);

		const layoutVideoContent = useCallback(() => {
			const container = containerRef.current;
			const app = appRef.current;
			const videoSprite = videoSpriteRef.current;
			const maskGraphics = maskGraphicsRef.current;
			const videoElement = videoRef.current;
			const cameraContainer = cameraContainerRef.current;

			if (
				!container ||
				!app ||
				!videoSprite ||
				!maskGraphics ||
				!videoElement ||
				!cameraContainer
			) {
				return;
			}

			// Lock video dimensions on first layout to prevent resize issues
			if (
				!lockedVideoDimensionsRef.current &&
				videoElement.videoWidth > 0 &&
				videoElement.videoHeight > 0
			) {
				lockedVideoDimensionsRef.current = {
					width: videoElement.videoWidth,
					height: videoElement.videoHeight,
				};
			}

			const result = layoutVideoContentUtil({
				container,
				app,
				videoSprite,
				maskGraphics,
				videoElement,
				cropRegion,
				lockedVideoDimensions: lockedVideoDimensionsRef.current,
				borderRadius,
				padding,
			});

			if (result) {
				stageSizeRef.current = result.stageSize;
				videoSizeRef.current = result.videoSize;
				baseScaleRef.current = result.baseScale;
				baseOffsetRef.current = result.baseOffset;
				baseMaskRef.current = result.maskRect;
				cropBoundsRef.current = result.cropBounds;

				// Reset camera container to identity
				cameraContainer.scale.set(1);
				cameraContainer.position.set(0, 0);

				const selectedId = selectedZoomIdRef.current;
				const activeRegion = selectedId
					? (zoomRegionsRef.current.find((region) => region.id === selectedId) ?? null)
					: null;

				updateOverlayForRegion(activeRegion);
			}
		}, [updateOverlayForRegion, cropRegion, borderRadius, padding]);

		useEffect(() => {
			layoutVideoContentRef.current = layoutVideoContent;
		}, [layoutVideoContent]);

		const selectedZoom = useMemo(() => {
			if (!selectedZoomId) return null;
			return zoomRegions.find((region) => region.id === selectedZoomId) ?? null;
		}, [zoomRegions, selectedZoomId]);

		useImperativeHandle(ref, () => ({
			video: videoRef.current,
			app: appRef.current,
			videoSprite: videoSpriteRef.current,
			videoContainer: videoContainerRef.current,
			containerRef,
			play: async () => {
				const vid = videoRef.current;
				if (!vid) return;
				try {
					allowPlaybackRef.current = true;
					await vid.play();
				} catch (error) {
					allowPlaybackRef.current = false;
					throw error;
				}
			},
			pause: () => {
				const video = videoRef.current;
				allowPlaybackRef.current = false;
				if (!video) {
					return;
				}
				video.pause();
			},
		}));

		const updateFocusFromClientPoint = (clientX: number, clientY: number) => {
			const overlayEl = overlayRef.current;
			if (!overlayEl) return;

			const regionId = selectedZoomIdRef.current;
			if (!regionId) return;

			const region = zoomRegionsRef.current.find((r) => r.id === regionId);
			if (!region) return;

			const rect = overlayEl.getBoundingClientRect();
			const stageWidth = rect.width;
			const stageHeight = rect.height;

			if (!stageWidth || !stageHeight) {
				return;
			}

			stageSizeRef.current = { width: stageWidth, height: stageHeight };

			const localX = clientX - rect.left;
			const localY = clientY - rect.top;

			const unclampedFocus: ZoomFocus = {
				cx: clamp01(localX / stageWidth),
				cy: clamp01(localY / stageHeight),
			};
			const clampedFocus = clampFocusToStage(unclampedFocus, region.depth);

			onZoomFocusChange(region.id, clampedFocus);
			updateOverlayForRegion({ ...region, focus: clampedFocus }, clampedFocus);
		};

		const handleOverlayPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
			if (isPlayingRef.current) return;
			const regionId = selectedZoomIdRef.current;
			if (!regionId) return;
			const region = zoomRegionsRef.current.find((r) => r.id === regionId);
			if (!region) return;
			onSelectZoom(region.id);
			event.preventDefault();
			isDraggingFocusRef.current = true;
			event.currentTarget.setPointerCapture(event.pointerId);
			updateFocusFromClientPoint(event.clientX, event.clientY);
		};

		const handleOverlayPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
			if (!isDraggingFocusRef.current) return;
			event.preventDefault();
			updateFocusFromClientPoint(event.clientX, event.clientY);
		};

		const endFocusDrag = (event: React.PointerEvent<HTMLDivElement>) => {
			if (!isDraggingFocusRef.current) return;
			isDraggingFocusRef.current = false;
			try {
				event.currentTarget.releasePointerCapture(event.pointerId);
			} catch {
				// releasePointerCapture is optional if pointer was not captured
			}
		};

		const handleOverlayPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
			endFocusDrag(event);
		};

		const handleOverlayPointerLeave = (event: React.PointerEvent<HTMLDivElement>) => {
			endFocusDrag(event);
		};

		useEffect(() => {
			zoomRegionsRef.current = zoomRegions;
		}, [zoomRegions]);

		useEffect(() => {
			selectedZoomIdRef.current = selectedZoomId;
		}, [selectedZoomId]);

		useEffect(() => {
			isPlayingRef.current = isPlaying;
		}, [isPlaying]);

		useEffect(() => {
			trimRegionsRef.current = trimRegions;
		}, [trimRegions]);

		useEffect(() => {
			speedRegionsRef.current = speedRegions;
		}, [speedRegions]);

		useEffect(() => {
			motionBlurEnabledRef.current = motionBlurEnabled;
		}, [motionBlurEnabled]);

		useEffect(() => {
			if (!pixiReady || !videoReady) return;

			const app = appRef.current;
			const cameraContainer = cameraContainerRef.current;
			const video = videoRef.current;

			if (!app || !cameraContainer || !video) return;

			const tickerWasStarted = app.ticker?.started || false;
			if (tickerWasStarted && app.ticker) {
				app.ticker.stop();
			}

			const wasPlaying = !video.paused;
			if (wasPlaying) {
				video.pause();
			}

			animationStateRef.current = {
				scale: 1,
				focusX: DEFAULT_FOCUS.cx,
				focusY: DEFAULT_FOCUS.cy,
			};

			if (blurFilterRef.current) {
				blurFilterRef.current.blur = 0;
			}

			requestAnimationFrame(() => {
				const container = cameraContainerRef.current;
				const videoStage = videoContainerRef.current;
				const sprite = videoSpriteRef.current;
				const currentApp = appRef.current;
				if (!container || !videoStage || !sprite || !currentApp) {
					return;
				}

				container.scale.set(1);
				container.position.set(0, 0);
				videoStage.scale.set(1);
				videoStage.position.set(0, 0);
				sprite.scale.set(1);
				sprite.position.set(0, 0);

				layoutVideoContent();

				applyZoomTransform({
					cameraContainer: container,
					blurFilter: blurFilterRef.current,
					stageSize: stageSizeRef.current,
					baseMask: baseMaskRef.current,
					zoomScale: 1,
					focusX: DEFAULT_FOCUS.cx,
					focusY: DEFAULT_FOCUS.cy,
					motionIntensity: 0,
					isPlaying: false,
					motionBlurEnabled: motionBlurEnabledRef.current,
				});

				requestAnimationFrame(() => {
					const finalApp = appRef.current;
					if (wasPlaying && video) {
						video.play().catch(() => {
							// play() can reject if interrupted
						});
					}
					if (tickerWasStarted && finalApp?.ticker) {
						finalApp.ticker.start();
					}
				});
			});
		}, [pixiReady, videoReady, layoutVideoContent]);

		useEffect(() => {
			if (!pixiReady || !videoReady) return;
			const container = containerRef.current;
			if (!container) return;

			if (typeof ResizeObserver === "undefined") {
				return;
			}

			const observer = new ResizeObserver(() => {
				layoutVideoContent();
			});

			observer.observe(container);
			return () => {
				observer.disconnect();
			};
		}, [pixiReady, videoReady, layoutVideoContent]);

		useEffect(() => {
			if (!pixiReady || !videoReady) return;
			updateOverlayForRegion(selectedZoom);
		}, [selectedZoom, pixiReady, videoReady, updateOverlayForRegion]);

		useEffect(() => {
			const overlayEl = overlayRef.current;
			if (!overlayEl) return;
			if (!selectedZoom) {
				overlayEl.style.cursor = "default";
				overlayEl.style.pointerEvents = "none";
				return;
			}
			overlayEl.style.cursor = isPlaying ? "not-allowed" : "grab";
			overlayEl.style.pointerEvents = isPlaying ? "none" : "auto";
		}, [selectedZoom, isPlaying]);

		useEffect(() => {
			const container = containerRef.current;
			if (!container) return;

			let mounted = true;
			let app: Application | null = null;

			(async () => {
				app = new Application();

				await app.init({
					width: container.clientWidth,
					height: container.clientHeight,
					backgroundAlpha: 0,
					antialias: true,
					resolution: window.devicePixelRatio || 1,
					autoDensity: true,
				});

				app.ticker.maxFPS = 60;

				if (!mounted) {
					app.destroy(true, { children: true, texture: true, textureSource: true });
					return;
				}

				appRef.current = app;
				container.appendChild(app.canvas);

				// Camera container - this will be scaled/positioned for zoom
				const cameraContainer = new Container();
				cameraContainerRef.current = cameraContainer;
				app.stage.addChild(cameraContainer);

				// Video container - holds the masked video sprite
				const videoContainer = new Container();
				videoContainerRef.current = videoContainer;
				cameraContainer.addChild(videoContainer);

				setPixiReady(true);
			})();

			return () => {
				mounted = false;
				setPixiReady(false);
				if (app && app.renderer) {
					app.destroy(true, { children: true, texture: true, textureSource: true });
				}
				appRef.current = null;
				cameraContainerRef.current = null;
				videoContainerRef.current = null;
				videoSpriteRef.current = null;
			};
		}, []);

		useEffect(() => {
			const video = videoRef.current;
			if (!video) return;
			video.pause();
			video.currentTime = 0;
			allowPlaybackRef.current = false;
			lockedVideoDimensionsRef.current = null;
			setVideoReady(false);
			cursorSmoothingRef.current = null;
			if (videoReadyRafRef.current) {
				cancelAnimationFrame(videoReadyRafRef.current);
				videoReadyRafRef.current = null;
			}
		}, []);

		const cursorPreview = (() => {
			if (
				!pixiReady ||
				!videoReady ||
				!resolvedCursorOverlay.enabled ||
				cursorTelemetry.length === 0
			) {
				cursorSmoothingRef.current = null;
				return null;
			}

			const durationMs = videoRef.current?.duration
				? Math.max(0, videoRef.current.duration * 1000)
				: undefined;
			const timeMs = currentTime * 1000;
			const previousState =
				cursorSmoothingRef.current && timeMs < cursorSmoothingRef.current.timeMs
					? null
					: cursorSmoothingRef.current;
			const resolved = resolveCursorSampleAtTime({
				samples: cursorTelemetry,
				timeMs,
				settings: resolvedCursorOverlay,
				previous: previousState,
				durationMs,
			});
			if (!resolved) {
				cursorSmoothingRef.current = null;
				return null;
			}
			cursorSmoothingRef.current = resolved.state;
			if (!resolved.visible) return null;
			const typingHideAmount = resolvedCursorOverlay.cursorOffWhenTyping
				? getTypingCursorHideAmountAtTime(
						keyboardTelemetry,
						currentTime * 1000,
						resolvedCursorOverlay.cursorTypingHideDelayMs,
					)
				: 0;
			if (typingHideAmount >= 0.999) return null;
			const clickPressAmount = getMouseClickPressAmountAtTime(
				mouseTelemetry,
				currentTime * 1000,
				100,
			);

			const crop = cropRegion ?? DEFAULT_CROP_REGION;
			const stagePoint = mapCursorToStage(resolved.point, crop, {
				x: baseMaskRef.current.x,
				y: baseMaskRef.current.y,
				width: baseMaskRef.current.width,
				height: baseMaskRef.current.height,
			});
			if (!stagePoint) return null;

			const zoomedPoint = transformPointByZoom(
				stagePoint,
				stageSizeRef.current,
				animationStateRef.current.scale,
				animationStateRef.current.focusX,
				animationStateRef.current.focusY,
			);

			const viewBox = getCursorViewBox();
			const colors = getCursorPresetColorsForSvg(resolvedCursorOverlay.preset);
			const scale = resolvedCursorOverlay.size / viewBox.height;
			const effectiveType = resolvedCursorOverlay.alwaysUseDefaultCursor
				? "macos"
				: resolvedCursorOverlay.cursorType;

			return {
				position: zoomedPoint,
				width: viewBox.width * scale,
				height: resolvedCursorOverlay.size,
				offsetX: viewBox.hotspotX * scale,
				offsetY: viewBox.hotspotY * scale,
				colors,
				cursorType: effectiveType,
				rotationDeg: resolved.rotationDeg,
				hideAmount: typingHideAmount,
				clickPressAmount,
			};
		})();

		useEffect(() => {
			let mounted = true;
			(async () => {
				try {
					const soundPaths = getKeyboardSoundRelativePaths(
						resolvedCursorOverlay.keyboardSoundPack ?? "k1",
					);
					const [key, space, enter] = await Promise.all([
						getAssetPath(soundPaths.key),
						getAssetPath(soundPaths.space),
						getAssetPath(soundPaths.enter),
					]);
					if (mounted) {
						keyboardAudioAssetsRef.current = { key, space, enter };
					}
				} catch (error) {
					console.warn("Unable to resolve keyboard sound assets:", error);
					if (mounted) {
						keyboardAudioAssetsRef.current = null;
					}
				}
			})();
			return () => {
				mounted = false;
			};
		}, [resolvedCursorOverlay.keyboardSoundPack]);

		useEffect(() => {
			let mounted = true;
			(async () => {
				try {
					const clickPath = await getAssetPath("assets/sounds/mouse_click.wav");
					if (mounted) {
						mouseClickAudioRef.current = clickPath;
					}
				} catch (error) {
					console.warn("Unable to resolve mouse click sound asset:", error);
					if (mounted) mouseClickAudioRef.current = null;
				}
			})();
			return () => {
				mounted = false;
			};
		}, []);

		useEffect(() => {
			const timeMs = Math.max(0, Math.round(currentTimeRef.current));
			let idx = 0;
			while (idx < keyboardTelemetry.length && keyboardTelemetry[idx].timeMs < timeMs) {
				idx += 1;
			}
			keyboardEventCursorRef.current = idx;
		}, [keyboardTelemetry]);

		useEffect(() => {
			const timeMs = Math.max(0, Math.round(currentTimeRef.current));
			let idx = 0;
			while (idx < mouseTelemetry.length && mouseTelemetry[idx].timeMs < timeMs) {
				idx += 1;
			}
			mouseClickEventCursorRef.current = idx;
		}, [mouseTelemetry]);

		useEffect(() => {
			if (
				!isPlaying ||
				!resolvedCursorOverlay.playKeyboardSounds ||
				keyboardTelemetry.length === 0
			) {
				return;
			}

			let rafId = 0;
			const playSample = (keyType: KeyboardTelemetryEvent["keyType"]) => {
				const assets = keyboardAudioAssetsRef.current;
				if (!assets) return;
				const src =
					keyType === "space" ? assets.space : keyType === "enter" ? assets.enter : assets.key;

				if (activeKeyboardAudioRef.current) {
					try {
						activeKeyboardAudioRef.current.pause();
						activeKeyboardAudioRef.current.currentTime = 0;
					} catch {
						// no-op
					}
				}

				const audio = new Audio(src);
				const volumeJitter = (Math.random() * 2 - 1) * 0.07;
				audio.volume = Math.max(0.16, Math.min(0.45, 0.3 + volumeJitter));
				audio.playbackRate = 1 + (Math.random() * 2 - 1) * 0.08;
				try {
					(
						audio as HTMLAudioElement & { preservesPitch?: boolean; mozPreservesPitch?: boolean }
					).preservesPitch = false;
					(audio as HTMLAudioElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch =
						false;
					(audio as HTMLAudioElement & { mozPreservesPitch?: boolean }).mozPreservesPitch = false;
				} catch {
					// no-op
				}
				activeKeyboardAudioRef.current = audio;
				void audio.play().catch(() => {
					// playback can fail if interrupted
				});
			};

			const tick = () => {
				if (!isPlayingRef.current) return;
				const nowMs = Math.max(
					0,
					Math.round(
						videoRef.current ? videoRef.current.currentTime * 1000 : currentTimeRef.current,
					),
				);
				const triggerWindowMs = 40;

				while (
					keyboardEventCursorRef.current < keyboardTelemetry.length &&
					keyboardTelemetry[keyboardEventCursorRef.current].timeMs <= nowMs + triggerWindowMs
				) {
					const event = keyboardTelemetry[keyboardEventCursorRef.current];
					if (event.timeMs >= nowMs - 250) {
						playSample(event.keyType);
					}
					keyboardEventCursorRef.current += 1;
				}
				rafId = requestAnimationFrame(tick);
			};

			rafId = requestAnimationFrame(tick);
			return () => {
				if (rafId) cancelAnimationFrame(rafId);
				if (activeKeyboardAudioRef.current) {
					try {
						activeKeyboardAudioRef.current.pause();
						activeKeyboardAudioRef.current.currentTime = 0;
					} catch {
						// no-op
					}
					activeKeyboardAudioRef.current = null;
				}
			};
		}, [isPlaying, keyboardTelemetry, resolvedCursorOverlay.playKeyboardSounds]);

		useEffect(() => {
			if (!isPlaying || mouseTelemetry.length === 0) {
				return;
			}

			let rafId = 0;
			const playClick = () => {
				const src = mouseClickAudioRef.current;
				if (!src) return;
				if (activeMouseClickAudioRef.current) {
					try {
						activeMouseClickAudioRef.current.pause();
						activeMouseClickAudioRef.current.currentTime = 0;
					} catch {
						// no-op
					}
				}
				const audio = new Audio(src);
				audio.volume = 0.3 + (Math.random() * 2 - 1) * 0.06;
				audio.playbackRate = 1 + (Math.random() * 2 - 1) * 0.05;
				activeMouseClickAudioRef.current = audio;
				void audio.play().catch(() => {
					// playback can fail if interrupted
				});
			};

			const tick = () => {
				if (!isPlayingRef.current) return;
				const nowMs = Math.max(
					0,
					Math.round(
						videoRef.current ? videoRef.current.currentTime * 1000 : currentTimeRef.current,
					),
				);
				const triggerWindowMs = 35;
				while (
					mouseClickEventCursorRef.current < mouseTelemetry.length &&
					mouseTelemetry[mouseClickEventCursorRef.current].timeMs <= nowMs + triggerWindowMs
				) {
					const event = mouseTelemetry[mouseClickEventCursorRef.current];
					if (event.timeMs >= nowMs - 250) {
						playClick();
					}
					mouseClickEventCursorRef.current += 1;
				}
				rafId = requestAnimationFrame(tick);
			};

			rafId = requestAnimationFrame(tick);
			return () => {
				if (rafId) cancelAnimationFrame(rafId);
				if (activeMouseClickAudioRef.current) {
					try {
						activeMouseClickAudioRef.current.pause();
						activeMouseClickAudioRef.current.currentTime = 0;
					} catch {
						// no-op
					}
					activeMouseClickAudioRef.current = null;
				}
			};
		}, [isPlaying, mouseTelemetry]);

		useEffect(() => {
			if (!pixiReady || !videoReady) return;

			const video = videoRef.current;
			const app = appRef.current;
			const videoContainer = videoContainerRef.current;

			if (!video || !app || !videoContainer) return;
			if (video.videoWidth === 0 || video.videoHeight === 0) return;

			const source = VideoSource.from(video);
			if ("autoPlay" in source) {
				(source as { autoPlay?: boolean }).autoPlay = false;
			}
			if ("autoUpdate" in source) {
				(source as { autoUpdate?: boolean }).autoUpdate = true;
			}
			const videoTexture = Texture.from(source);

			const videoSprite = new Sprite(videoTexture);
			videoSpriteRef.current = videoSprite;

			const maskGraphics = new Graphics();
			videoContainer.addChild(videoSprite);
			videoContainer.addChild(maskGraphics);
			videoContainer.mask = maskGraphics;
			maskGraphicsRef.current = maskGraphics;

			animationStateRef.current = {
				scale: 1,
				focusX: DEFAULT_FOCUS.cx,
				focusY: DEFAULT_FOCUS.cy,
			};

			const blurFilter = new BlurFilter();
			blurFilter.quality = 3;
			blurFilter.resolution = app.renderer.resolution;
			blurFilter.blur = 0;
			videoContainer.filters = [blurFilter];
			blurFilterRef.current = blurFilter;

			layoutVideoContent();
			video.pause();

			const { handlePlay, handlePause, handleSeeked, handleSeeking } = createVideoEventHandlers({
				video,
				isSeekingRef,
				isPlayingRef,
				allowPlaybackRef,
				currentTimeRef,
				timeUpdateAnimationRef,
				onPlayStateChange,
				onTimeUpdate,
				trimRegionsRef,
				speedRegionsRef,
			});

			video.addEventListener("play", handlePlay);
			video.addEventListener("pause", handlePause);
			video.addEventListener("ended", handlePause);
			video.addEventListener("seeked", handleSeeked);
			video.addEventListener("seeking", handleSeeking);

			return () => {
				video.removeEventListener("play", handlePlay);
				video.removeEventListener("pause", handlePause);
				video.removeEventListener("ended", handlePause);
				video.removeEventListener("seeked", handleSeeked);
				video.removeEventListener("seeking", handleSeeking);

				if (timeUpdateAnimationRef.current) {
					cancelAnimationFrame(timeUpdateAnimationRef.current);
				}

				if (videoSprite) {
					videoContainer.removeChild(videoSprite);
					videoSprite.destroy();
				}
				if (maskGraphics) {
					videoContainer.removeChild(maskGraphics);
					maskGraphics.destroy();
				}
				videoContainer.mask = null;
				maskGraphicsRef.current = null;
				if (blurFilterRef.current) {
					videoContainer.filters = [];
					blurFilterRef.current.destroy();
					blurFilterRef.current = null;
				}
				videoTexture.destroy(true);

				videoSpriteRef.current = null;
			};
		}, [pixiReady, videoReady, onTimeUpdate, layoutVideoContent, onPlayStateChange]);

		useEffect(() => {
			if (!pixiReady || !videoReady) return;

			const app = appRef.current;
			const videoSprite = videoSpriteRef.current;
			const videoContainer = videoContainerRef.current;
			if (!app || !videoSprite || !videoContainer) return;

			const applyTransform = (motionIntensity: number) => {
				const cameraContainer = cameraContainerRef.current;
				if (!cameraContainer) return;

				const state = animationStateRef.current;

				applyZoomTransform({
					cameraContainer,
					blurFilter: blurFilterRef.current,
					stageSize: stageSizeRef.current,
					baseMask: baseMaskRef.current,
					zoomScale: state.scale,
					focusX: state.focusX,
					focusY: state.focusY,
					motionIntensity,
					isPlaying: isPlayingRef.current,
					motionBlurEnabled: motionBlurEnabledRef.current,
				});
			};

			const ticker = () => {
				const { region, strength } = findDominantRegion(
					zoomRegionsRef.current,
					currentTimeRef.current,
				);

				const defaultFocus = DEFAULT_FOCUS;
				let targetScaleFactor = 1;
				let targetFocus = defaultFocus;

				// If a zoom is selected but video is not playing, show default unzoomed view
				// (the overlay will show where the zoom will be)
				const selectedId = selectedZoomIdRef.current;
				const hasSelectedZoom = selectedId !== null;
				const shouldShowUnzoomedView = hasSelectedZoom && !isPlayingRef.current;

				if (region && strength > 0 && !shouldShowUnzoomedView) {
					const zoomScale = ZOOM_DEPTH_SCALES[region.depth];
					const regionFocus = clampFocusToStage(region.focus, region.depth);

					// Interpolate scale and focus based on region strength
					targetScaleFactor = 1 + (zoomScale - 1) * strength;
					targetFocus = {
						cx: defaultFocus.cx + (regionFocus.cx - defaultFocus.cx) * strength,
						cy: defaultFocus.cy + (regionFocus.cy - defaultFocus.cy) * strength,
					};
				}

				const state = animationStateRef.current;

				const prevScale = state.scale;
				const prevFocusX = state.focusX;
				const prevFocusY = state.focusY;

				const scaleDelta = targetScaleFactor - state.scale;
				const focusXDelta = targetFocus.cx - state.focusX;
				const focusYDelta = targetFocus.cy - state.focusY;

				let nextScale = prevScale;
				let nextFocusX = prevFocusX;
				let nextFocusY = prevFocusY;

				if (Math.abs(scaleDelta) > MIN_DELTA) {
					nextScale = prevScale + scaleDelta * SMOOTHING_FACTOR;
				} else {
					nextScale = targetScaleFactor;
				}

				if (Math.abs(focusXDelta) > MIN_DELTA) {
					nextFocusX = prevFocusX + focusXDelta * SMOOTHING_FACTOR;
				} else {
					nextFocusX = targetFocus.cx;
				}

				if (Math.abs(focusYDelta) > MIN_DELTA) {
					nextFocusY = prevFocusY + focusYDelta * SMOOTHING_FACTOR;
				} else {
					nextFocusY = targetFocus.cy;
				}

				state.scale = nextScale;
				state.focusX = nextFocusX;
				state.focusY = nextFocusY;

				const motionIntensity = Math.max(
					Math.abs(nextScale - prevScale),
					Math.abs(nextFocusX - prevFocusX),
					Math.abs(nextFocusY - prevFocusY),
				);

				applyTransform(motionIntensity);
			};

			app.ticker.add(ticker);
			return () => {
				if (app && app.ticker) {
					app.ticker.remove(ticker);
				}
			};
		}, [pixiReady, videoReady, clampFocusToStage]);

		const handleLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement, Event>) => {
			const video = e.currentTarget;
			onDurationChange(video.duration);
			video.currentTime = 0;
			video.pause();
			allowPlaybackRef.current = false;
			currentTimeRef.current = 0;

			if (videoReadyRafRef.current) {
				cancelAnimationFrame(videoReadyRafRef.current);
				videoReadyRafRef.current = null;
			}

			const waitForRenderableFrame = () => {
				const hasDimensions = video.videoWidth > 0 && video.videoHeight > 0;
				const hasData = video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
				if (hasDimensions && hasData) {
					videoReadyRafRef.current = null;
					setVideoReady(true);
					return;
				}
				videoReadyRafRef.current = requestAnimationFrame(waitForRenderableFrame);
			};

			videoReadyRafRef.current = requestAnimationFrame(waitForRenderableFrame);
		};

		const [resolvedWallpaper, setResolvedWallpaper] = useState<string | null>(null);

		useEffect(() => {
			let mounted = true;
			(async () => {
				try {
					if (!wallpaper) {
						const def = await getAssetPath("wallpapers/wallpaper1.jpg");
						if (mounted) setResolvedWallpaper(def);
						return;
					}

					if (
						wallpaper.startsWith("#") ||
						wallpaper.startsWith("linear-gradient") ||
						wallpaper.startsWith("radial-gradient")
					) {
						if (mounted) setResolvedWallpaper(wallpaper);
						return;
					}

					// If it's a data URL (custom uploaded image), use as-is
					if (wallpaper.startsWith("data:")) {
						if (mounted) setResolvedWallpaper(wallpaper);
						return;
					}

					// If it's an absolute web/http or file path, use as-is
					if (
						wallpaper.startsWith("http") ||
						wallpaper.startsWith("file://") ||
						wallpaper.startsWith("/")
					) {
						// If it's an absolute server path (starts with '/'), resolve via getAssetPath as well
						if (wallpaper.startsWith("/")) {
							const rel = wallpaper.replace(/^\//, "");
							const p = await getAssetPath(rel);
							if (mounted) setResolvedWallpaper(p);
							return;
						}
						if (mounted) setResolvedWallpaper(wallpaper);
						return;
					}
					const p = await getAssetPath(wallpaper.replace(/^\//, ""));
					if (mounted) setResolvedWallpaper(p);
				} catch {
					if (mounted) setResolvedWallpaper(wallpaper || "/wallpapers/wallpaper1.jpg");
				}
			})();
			return () => {
				mounted = false;
			};
		}, [wallpaper]);

		useEffect(() => {
			return () => {
				if (videoReadyRafRef.current) {
					cancelAnimationFrame(videoReadyRafRef.current);
					videoReadyRafRef.current = null;
				}
			};
		}, []);

		const isImageUrl = Boolean(
			resolvedWallpaper &&
				(resolvedWallpaper.startsWith("file://") ||
					resolvedWallpaper.startsWith("http") ||
					resolvedWallpaper.startsWith("/") ||
					resolvedWallpaper.startsWith("data:")),
		);
		const backgroundStyle = isImageUrl
			? { backgroundImage: `url(${resolvedWallpaper || ""})` }
			: { background: resolvedWallpaper || "" };

		return (
			<div
				className="relative rounded-sm overflow-hidden"
				style={{ width: "100%", aspectRatio: formatAspectRatioForCSS(aspectRatio) }}
			>
				{/* Background layer - always render as DOM element with blur */}
				<div
					className="absolute inset-0 bg-cover bg-center"
					style={{
						...backgroundStyle,
						filter: showBlur ? "blur(2px)" : "none",
					}}
				/>
				<div
					ref={containerRef}
					className="absolute inset-0"
					style={{
						filter:
							showShadow && shadowIntensity > 0
								? `drop-shadow(0 ${shadowIntensity * 12}px ${shadowIntensity * 48}px rgba(0,0,0,${shadowIntensity * 0.7})) drop-shadow(0 ${shadowIntensity * 4}px ${shadowIntensity * 16}px rgba(0,0,0,${shadowIntensity * 0.5})) drop-shadow(0 ${shadowIntensity * 2}px ${shadowIntensity * 8}px rgba(0,0,0,${shadowIntensity * 0.3}))`
								: "none",
					}}
				/>
				{/* Only render overlay after PIXI and video are fully initialized */}
				{pixiReady && videoReady && (
					<div
						ref={overlayRef}
						className="absolute inset-0 select-none"
						style={{ pointerEvents: "none" }}
						onPointerDown={handleOverlayPointerDown}
						onPointerMove={handleOverlayPointerMove}
						onPointerUp={handleOverlayPointerUp}
						onPointerLeave={handleOverlayPointerLeave}
					>
						<div
							ref={focusIndicatorRef}
							className="absolute rounded-md border border-[#34B27B]/80 bg-[#34B27B]/20 shadow-[0_0_0_1px_rgba(52,178,123,0.35)]"
							style={{ display: "none", pointerEvents: "none" }}
						/>
						{cursorPreview && (
							<div
								className="absolute"
								style={{
									left: `${cursorPreview.position.x - cursorPreview.offsetX}px`,
									top: `${cursorPreview.position.y - cursorPreview.offsetY}px`,
									width: `${cursorPreview.width}px`,
									height: `${cursorPreview.height}px`,
									pointerEvents: "none",
									filter: "drop-shadow(0 1px 1.5px rgba(0,0,0,0.3))",
									opacity: Math.max(0, 1 - cursorPreview.hideAmount),
									transform:
										cursorPreview.cursorType === "macos"
											? `rotate(${cursorPreview.rotationDeg}deg) scale(${Math.max(0.8, (1 - cursorPreview.hideAmount * 0.16) * (1 - cursorPreview.clickPressAmount * 0.14))})`
											: `scale(${Math.max(0.8, (1 - cursorPreview.hideAmount * 0.16) * (1 - cursorPreview.clickPressAmount * 0.14))})`,
									transformOrigin:
										cursorPreview.cursorType === "macos" ? "2px 1px" : "center center",
								}}
							>
								{cursorPreview.cursorType === "touch" ? (
									<div
										style={{
											width: `${cursorPreview.height}px`,
											height: `${cursorPreview.height}px`,
											borderRadius: "9999px",
											background: cursorPreview.colors.fill,
											border: `2px solid ${cursorPreview.colors.stroke}`,
											boxSizing: "border-box",
											transform: `rotate(${cursorPreview.rotationDeg}deg)`,
											transformOrigin: "center center",
										}}
									/>
								) : (
									<svg
										viewBox={`0 0 ${getCursorViewBox().width} ${getCursorViewBox().height}`}
										width="100%"
										height="100%"
									>
										<path
											d={getCursorSvgPath()}
											fill={cursorPreview.colors.fill}
											stroke={cursorPreview.colors.stroke}
											strokeWidth={1.7}
											strokeLinejoin="round"
											strokeLinecap="round"
										/>
									</svg>
								)}
							</div>
						)}
						{(() => {
							const filtered = (annotationRegions || []).filter((annotation) => {
								if (typeof annotation.startMs !== "number" || typeof annotation.endMs !== "number")
									return false;

								if (annotation.id === selectedAnnotationId) return true;

								const timeMs = Math.round(currentTime * 1000);
								return timeMs >= annotation.startMs && timeMs <= annotation.endMs;
							});

							// Sort by z-index (lowest to highest) so higher z-index renders on top
							const sorted = [...filtered].sort((a, b) => a.zIndex - b.zIndex);

							// Handle click-through cycling: when clicking same annotation, cycle to next
							const handleAnnotationClick = (clickedId: string) => {
								if (!onSelectAnnotation) return;

								// If clicking on already selected annotation and there are multiple overlapping
								if (clickedId === selectedAnnotationId && sorted.length > 1) {
									// Find current index and cycle to next
									const currentIndex = sorted.findIndex((a) => a.id === clickedId);
									const nextIndex = (currentIndex + 1) % sorted.length;
									onSelectAnnotation(sorted[nextIndex].id);
								} else {
									// First click or clicking different annotation
									onSelectAnnotation(clickedId);
								}
							};

							return sorted.map((annotation) => (
								<AnnotationOverlay
									key={annotation.id}
									annotation={annotation}
									isSelected={annotation.id === selectedAnnotationId}
									containerWidth={overlayRef.current?.clientWidth || 800}
									containerHeight={overlayRef.current?.clientHeight || 600}
									onPositionChange={(id, position) => onAnnotationPositionChange?.(id, position)}
									onSizeChange={(id, size) => onAnnotationSizeChange?.(id, size)}
									onClick={handleAnnotationClick}
									zIndex={annotation.zIndex}
									isSelectedBoost={annotation.id === selectedAnnotationId}
								/>
							));
						})()}
					</div>
				)}
				<video
					ref={videoRef}
					src={videoPath}
					className="hidden"
					preload="metadata"
					playsInline
					onLoadedMetadata={handleLoadedMetadata}
					onDurationChange={(e) => {
						onDurationChange(e.currentTarget.duration);
					}}
					onError={() => onError("Failed to load video")}
				/>
			</div>
		);
	},
);

VideoPlayback.displayName = "VideoPlayback";

export default VideoPlayback;
