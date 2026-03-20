import type { MouseClickTelemetryEvent } from "./types";

export function normalizeMouseTelemetry(candidate: unknown): MouseClickTelemetryEvent[] {
	if (!Array.isArray(candidate)) return [];
	return candidate
		.filter((event): event is Partial<MouseClickTelemetryEvent> =>
			Boolean(event && typeof event === "object"),
		)
		.map((event) => ({
			timeMs:
				typeof event.timeMs === "number" && Number.isFinite(event.timeMs)
					? Math.max(0, Math.round(event.timeMs))
					: 0,
			button: (event.button === "right" || event.button === "other"
				? event.button
				: "left") as MouseClickTelemetryEvent["button"],
		}))
		.sort((a, b) => a.timeMs - b.timeMs);
}

export function getMouseClickPressAmountAtTime(
	events: MouseClickTelemetryEvent[],
	timeMs: number,
	clickDurationMs = 100,
): number {
	if (events.length === 0) return 0;
	const t = Math.max(0, timeMs);
	const duration = Math.max(40, clickDurationMs);

	let low = 0;
	let high = events.length - 1;
	let idx = -1;
	while (low <= high) {
		const mid = Math.floor((low + high) / 2);
		if (events[mid].timeMs <= t) {
			idx = mid;
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}
	if (idx < 0) return 0;

	const elapsed = t - events[idx].timeMs;
	if (elapsed < 0 || elapsed > duration) return 0;
	const half = duration * 0.5;
	if (elapsed <= half) return elapsed / half;
	return Math.max(0, 1 - (elapsed - half) / half);
}
