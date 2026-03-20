import { describe, expect, it } from "vitest";
import { normalizeProjectEditor } from "./projectPersistence";
import { DEFAULT_CURSOR_OVERLAY_SETTINGS } from "./types";

describe("projectPersistence cursor overlay", () => {
	it("applies cursor defaults for legacy projects", () => {
		const normalized = normalizeProjectEditor({
			wallpaper: "/wallpapers/wallpaper1.jpg",
			zoomRegions: [],
			trimRegions: [],
			speedRegions: [],
			annotationRegions: [],
		});

		expect(normalized.cursorOverlay).toEqual(DEFAULT_CURSOR_OVERLAY_SETTINGS);
	});

	it("normalizes and preserves cursor settings", () => {
		const normalized = normalizeProjectEditor({
			wallpaper: "/wallpapers/wallpaper1.jpg",
			zoomRegions: [],
			trimRegions: [],
			speedRegions: [],
			annotationRegions: [],
			cursorOverlay: {
				enabled: true,
				preset: "dark",
				size: 60,
				smoothing: 0.35,
			},
		});

		expect(normalized.cursorOverlay).toMatchObject({
			enabled: true,
			preset: "dark",
			size: 60,
			smoothing: 0.35,
		});
	});
});
