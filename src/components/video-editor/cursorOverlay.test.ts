import { describe, expect, it } from "vitest";
import {
	interpolateCursorPosition,
	normalizeCursorOverlaySettings,
	resolveCursorSampleAtTime,
	smoothCursorPosition,
} from "./cursorOverlay";
import { DEFAULT_CURSOR_OVERLAY_SETTINGS } from "./types";

describe("cursorOverlay interpolation", () => {
	it("returns exact sample when timestamp matches", () => {
		const samples = [
			{ timeMs: 0, cx: 0.1, cy: 0.2 },
			{ timeMs: 100, cx: 0.4, cy: 0.7 },
		];

		const point = interpolateCursorPosition(samples, 100);
		expect(point).toEqual(samples[1]);
	});

	it("linearly interpolates between neighboring samples", () => {
		const samples = [
			{ timeMs: 0, cx: 0, cy: 0 },
			{ timeMs: 100, cx: 1, cy: 1 },
		];

		const point = interpolateCursorPosition(samples, 25);
		expect(point?.cx).toBeCloseTo(0.25, 5);
		expect(point?.cy).toBeCloseTo(0.25, 5);
	});

	it("clamps before first and after last sample", () => {
		const samples = [
			{ timeMs: 100, cx: 0.2, cy: 0.3 },
			{ timeMs: 200, cx: 0.6, cy: 0.8 },
		];

		expect(interpolateCursorPosition(samples, 20)).toEqual(samples[0]);
		expect(interpolateCursorPosition(samples, 900)).toEqual(samples[1]);
	});

	it("handles sparse telemetry with a single sample", () => {
		const samples = [{ timeMs: 50, cx: 0.8, cy: 0.1 }];
		expect(interpolateCursorPosition(samples, 500)).toEqual(samples[0]);
	});
});

describe("cursorOverlay smoothing", () => {
	it("reduces micro-jitter when smoothing is enabled", () => {
		const settings = normalizeCursorOverlaySettings({ smoothing: 0.9 });
		const previous = { timeMs: 1000, cx: 0.5, cy: 0.5, lastMoveTimeMs: 1000 };
		const raw = { timeMs: 1016, cx: 0.52, cy: 0.49 };

		const result = smoothCursorPosition(raw, settings, previous);
		expect(result.point.cx).toBeLessThan(raw.cx);
		expect(result.point.cy).toBeGreaterThan(raw.cy);
	});

	it("tracks fast movement without excessive lag", () => {
		const settings = normalizeCursorOverlaySettings({ smoothing: 0.9 });
		const previous = { timeMs: 1000, cx: 0.1, cy: 0.1, lastMoveTimeMs: 1000 };
		const raw = { timeMs: 1016, cx: 0.9, cy: 0.9 };

		const result = smoothCursorPosition(raw, settings, previous);
		expect(result.point.cx).toBeGreaterThan(0.55);
		expect(result.point.cy).toBeGreaterThan(0.55);
	});

	it("falls back to raw point when smoothing is disabled", () => {
		const raw = { timeMs: 1200, cx: 0.3, cy: 0.7 };
		const settings = { ...DEFAULT_CURSOR_OVERLAY_SETTINGS, smoothing: 0 };

		const result = smoothCursorPosition(raw, settings, {
			timeMs: 1100,
			cx: 0,
			cy: 0,
			lastMoveTimeMs: 1100,
		});
		expect(result.point).toEqual(raw);
	});
});

describe("cursorOverlay advanced behavior", () => {
	it("freezes movement near end when stopAtEnd is enabled", () => {
		const settings = normalizeCursorOverlaySettings({
			stopAtEnd: true,
			stopAtEndMs: 300,
		});
		const samples = [
			{ timeMs: 0, cx: 0.1, cy: 0.1 },
			{ timeMs: 1000, cx: 0.8, cy: 0.8 },
		];

		const s1 = resolveCursorSampleAtTime({
			samples,
			timeMs: 900,
			settings,
			previous: null,
			durationMs: 1000,
		});
		const s2 = resolveCursorSampleAtTime({
			samples,
			timeMs: 1000,
			settings,
			previous: s1?.state ?? null,
			durationMs: 1000,
		});

		expect(s1?.point.cx).toBeCloseTo(s2?.point.cx ?? 0, 6);
		expect(s1?.point.cy).toBeCloseTo(s2?.point.cy ?? 0, 6);
	});

	it("eases rotation toward movement angle and back to rest when idle", () => {
		const settings = normalizeCursorOverlaySettings({
			rotateWhileMoving: true,
			smoothing: 0,
			rotationMoveThreshold: 0.08,
			rotationFullTiltSpeed: 1,
			rotationFollowStrength: 30,
			rotationDamping: 7,
			rotationCoastDamping: 12,
			rotationTipStartIntensity: 0.7,
			rotationTipMaxDeg: 48,
		});
		const samples = [
			{ timeMs: 0, cx: 0.4, cy: 0.6 },
			{ timeMs: 100, cx: 0.6, cy: 0.4 },
			{ timeMs: 200, cx: 0.6, cy: 0.4 },
		];

		const first = resolveCursorSampleAtTime({
			samples,
			timeMs: 0,
			settings,
			previous: null,
		});
		const moving = resolveCursorSampleAtTime({
			samples,
			timeMs: 100,
			settings,
			previous: first?.state ?? null,
		});
		const idle1 = resolveCursorSampleAtTime({
			samples,
			timeMs: 200,
			settings,
			previous: moving?.state ?? null,
		});
		const idle2 = resolveCursorSampleAtTime({
			samples,
			timeMs: 300,
			settings,
			previous: idle1?.state ?? null,
		});

		expect(moving?.rotationDeg ?? 0).toBeGreaterThan(15);
		expect(Math.abs(idle2?.rotationDeg ?? 0)).toBeLessThan(Math.abs(idle1?.rotationDeg ?? 0));
	});

	it("stays stable at very low movement speed", () => {
		const settings = normalizeCursorOverlaySettings({
			rotateWhileMoving: true,
			smoothing: 0,
		});
		const samples = [
			{ timeMs: 0, cx: 0.5, cy: 0.5 },
			{ timeMs: 100, cx: 0.505, cy: 0.5 },
		];

		const first = resolveCursorSampleAtTime({
			samples,
			timeMs: 0,
			settings,
			previous: null,
		});
		const second = resolveCursorSampleAtTime({
			samples,
			timeMs: 100,
			settings,
			previous: first?.state ?? null,
		});

		expect(Math.abs(second?.rotationDeg ?? 0)).toBeLessThan(1);
	});

	it("can tip past 90 degrees on strong down-left motion", () => {
		const settings = normalizeCursorOverlaySettings({
			rotateWhileMoving: true,
			smoothing: 0,
			rotationMoveThreshold: 0.08,
			rotationFullTiltSpeed: 1,
			rotationFollowStrength: 30,
			rotationDamping: 7,
			rotationCoastDamping: 12,
			rotationTipStartIntensity: 0.7,
			rotationTipMaxDeg: 48,
		});
		const samples = [
			{ timeMs: 0, cx: 0.85, cy: 0.15 },
			{ timeMs: 100, cx: 0.7, cy: 0.3 },
			{ timeMs: 200, cx: 0.55, cy: 0.45 },
			{ timeMs: 300, cx: 0.4, cy: 0.6 },
			{ timeMs: 400, cx: 0.25, cy: 0.75 },
		];

		let state = resolveCursorSampleAtTime({
			samples,
			timeMs: 0,
			settings,
			previous: null,
		})?.state;

		let maxAbsRotation = 0;
		for (let t = 100; t <= 520; t += 16) {
			const resolved = resolveCursorSampleAtTime({
				samples,
				timeMs: t,
				settings,
				previous: state ?? null,
			});
			state = resolved?.state ?? null;
			maxAbsRotation = Math.max(maxAbsRotation, Math.abs(resolved?.rotationDeg ?? 0));
		}

		expect(maxAbsRotation).toBeGreaterThan(90);
	});
});
