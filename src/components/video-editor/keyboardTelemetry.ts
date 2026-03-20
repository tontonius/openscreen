import type { KeyboardTelemetryEvent } from "./types";

const DEFAULT_TYPING_HIDE_MS = 150;
const DEFAULT_TYPING_FADE_MS = 120;

export function normalizeKeyboardTelemetry(candidate: unknown): KeyboardTelemetryEvent[] {
	if (!Array.isArray(candidate)) return [];

	return candidate
		.filter((event): event is Partial<KeyboardTelemetryEvent> =>
			Boolean(event && typeof event === "object"),
		)
		.map((event) => {
			const rawTime =
				typeof event.timeMs === "number" && Number.isFinite(event.timeMs) ? event.timeMs : 0;
			const keyType =
				event.keyType === "space" || event.keyType === "enter" || event.keyType === "key"
					? event.keyType
					: "key";
			return {
				timeMs: Math.max(0, Math.round(rawTime)),
				keyType,
			};
		})
		.sort((a, b) => a.timeMs - b.timeMs);
}

export function isTypingActiveAtTime(
	events: KeyboardTelemetryEvent[],
	timeMs: number,
	hideDurationMs = DEFAULT_TYPING_HIDE_MS,
): boolean {
	if (events.length === 0) return false;
	const t = Math.max(0, timeMs);
	const hold = Math.max(30, hideDurationMs);

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
	if (idx < 0) return false;
	return t - events[idx].timeMs <= hold;
}

export function getTypingCursorHideAmountAtTime(
	events: KeyboardTelemetryEvent[],
	timeMs: number,
	hideDelayMs: number,
	fadeDurationMs = DEFAULT_TYPING_FADE_MS,
): number {
	if (events.length === 0) return 0;
	const t = Math.max(0, timeMs);
	const hold = Math.max(30, hideDelayMs);
	const fade = Math.max(20, fadeDurationMs);
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

	let hideAmount = 0;
	for (let i = idx; i >= 0; i -= 1) {
		const elapsed = t - events[i].timeMs;
		if (elapsed > hold + fade) {
			break;
		}
		if (elapsed < 0) {
			continue;
		}

		let amount = 0;
		if (elapsed < fade) {
			amount = Math.max(0, Math.min(1, elapsed / fade));
		} else if (elapsed <= hold) {
			amount = 1;
		} else if (elapsed < hold + fade) {
			amount = Math.max(0, Math.min(1, 1 - (elapsed - hold) / fade));
		}

		if (amount > hideAmount) {
			hideAmount = amount;
			if (hideAmount >= 1) {
				return 1;
			}
		}
	}

	return hideAmount;
}
