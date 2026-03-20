import type { KeyboardSoundPack } from "./types";

export const KEYBOARD_SOUND_PACK_OPTIONS: Array<{ value: KeyboardSoundPack; label: string }> = [
	{ value: "k1", label: "K1" },
	{ value: "k2", label: "K2" },
	{ value: "k3", label: "K3" },
	{ value: "k4", label: "K4" },
	{ value: "k5", label: "K5" },
	{ value: "k6", label: "K6" },
];

export function getKeyboardSoundRelativePaths(pack: KeyboardSoundPack): {
	key: string;
	space: string;
	enter: string;
} {
	const root = `assets/sounds/${pack}`;
	return {
		key: `${root}/press_key.wav`,
		space: `${root}/press_space.wav`,
		enter: `${root}/press_enter.wav`,
	};
}
