import type { WebDemuxer } from "web-demuxer";
import type {
	KeyboardTelemetryEvent,
	MouseClickTelemetryEvent,
	SpeedRegion,
	TrimRegion,
} from "@/components/video-editor/types";
import type { VideoMuxer } from "./muxer";

const AUDIO_BITRATE = 128_000;
const DECODE_BACKPRESSURE_LIMIT = 20;
const OPUS_FRAME_SIZE = 960;

interface KeyboardSoundBuffers {
	key: ArrayBuffer;
	space: ArrayBuffer;
	enter: ArrayBuffer;
}

interface AudioProcessOptions {
	keyboardEvents?: KeyboardTelemetryEvent[];
	mouseClickEvents?: MouseClickTelemetryEvent[];
	speedRegions?: SpeedRegion[];
	keyboardSounds?: KeyboardSoundBuffers;
	mouseClickSound?: ArrayBuffer;
	durationMs?: number;
	includeSourceAudio?: boolean;
}

export class AudioProcessor {
	private cancelled = false;

	async process(
		demuxer: WebDemuxer,
		muxer: VideoMuxer,
		trimRegions?: TrimRegion[],
		options?: AudioProcessOptions,
	): Promise<void> {
		let audioConfig: AudioDecoderConfig;
		let hasSourceAudio = true;
		try {
			audioConfig = (await demuxer.getDecoderConfig("audio")) as AudioDecoderConfig;
		} catch {
			audioConfig = {
				codec: "opus",
				sampleRate: 48_000,
				numberOfChannels: 2,
			};
			hasSourceAudio = false;
		}

		const includeSourceAudio = options?.includeSourceAudio ?? true;
		if (hasSourceAudio && includeSourceAudio) {
			const codecCheck = await AudioDecoder.isConfigSupported(audioConfig);
			if (!codecCheck.supported) {
				console.warn("[AudioProcessor] Audio codec not supported:", audioConfig.codec);
				hasSourceAudio = false;
			}
		}

		const sortedTrims = trimRegions ? [...trimRegions].sort((a, b) => a.startMs - b.startMs) : [];
		const sortedSpeeds = options?.speedRegions
			? [...options.speedRegions].sort((a, b) => a.startMs - b.startMs)
			: [];
		const keyboardEvents = options?.keyboardEvents ?? [];
		const mouseClickEvents = options?.mouseClickEvents ?? [];
		const keyboardSounds = options?.keyboardSounds;
		const mouseClickSound = options?.mouseClickSound;
		const durationMs = Math.max(0, Math.round(options?.durationMs ?? 0));
		const canGenerateKeyboardTrack =
			(keyboardEvents.length > 0 && Boolean(keyboardSounds)) ||
			(mouseClickEvents.length > 0 && Boolean(mouseClickSound));
		const canGenerateEffectsTrack =
			canGenerateKeyboardTrack && durationMs > 0 && typeof OfflineAudioContext !== "undefined";

		if (!hasSourceAudio && !canGenerateEffectsTrack) {
			console.warn("[AudioProcessor] No usable audio source, skipping");
			return;
		}

		if (!hasSourceAudio && canGenerateEffectsTrack) {
			await this.encodeEffectsOnlyTrack(
				muxer,
				keyboardEvents,
				mouseClickEvents,
				keyboardSounds,
				mouseClickSound,
				durationMs,
				sortedTrims,
				sortedSpeeds,
			);
			return;
		}

		// Phase 1: Decode audio from source, skipping trimmed regions
		const decodedFrames: AudioData[] = [];
		const decoder = new AudioDecoder({
			output: (data: AudioData) => decodedFrames.push(data),
			error: (e: DOMException) => console.error("[AudioProcessor] Decode error:", e),
		});
		decoder.configure(audioConfig);

		const reader = (demuxer.read("audio") as ReadableStream<EncodedAudioChunk>).getReader();

		while (!this.cancelled) {
			const { done, value: chunk } = await reader.read();
			if (done || !chunk) break;

			const timestampMs = chunk.timestamp / 1000;
			if (this.isInTrimRegion(timestampMs, sortedTrims)) continue;

			decoder.decode(chunk);

			while (decoder.decodeQueueSize > DECODE_BACKPRESSURE_LIMIT && !this.cancelled) {
				await new Promise((resolve) => setTimeout(resolve, 1));
			}
		}

		if (decoder.state === "configured") {
			await decoder.flush();
			decoder.close();
		}

		if (this.cancelled || decodedFrames.length === 0) {
			for (const f of decodedFrames) f.close();
			if (canGenerateEffectsTrack) {
				await this.encodeEffectsOnlyTrack(
					muxer,
					keyboardEvents,
					mouseClickEvents,
					keyboardSounds,
					mouseClickSound,
					durationMs,
					sortedTrims,
					sortedSpeeds,
				);
			}
			return;
		}

		// Phase 2: Re-encode with timestamps adjusted for trim gaps
		const encodedChunks: { chunk: EncodedAudioChunk; meta?: EncodedAudioChunkMetadata }[] = [];

		const encoder = new AudioEncoder({
			output: (chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) => {
				encodedChunks.push({ chunk, meta });
			},
			error: (e: DOMException) => console.error("[AudioProcessor] Encode error:", e),
		});

		const sampleRate = audioConfig.sampleRate || 48000;
		const channels = audioConfig.numberOfChannels || 2;

		const encodeConfig: AudioEncoderConfig = {
			codec: "opus",
			sampleRate,
			numberOfChannels: channels,
			bitrate: AUDIO_BITRATE,
		};

		const encodeSupport = await AudioEncoder.isConfigSupported(encodeConfig);
		if (!encodeSupport.supported) {
			console.warn("[AudioProcessor] Opus encoding not supported, skipping audio");
			for (const f of decodedFrames) f.close();
			return;
		}

		encoder.configure(encodeConfig);

		for (const audioData of decodedFrames) {
			if (this.cancelled) {
				audioData.close();
				continue;
			}

			const timestampMs = audioData.timestamp / 1000;
			const trimOffsetMs = this.computeTrimOffset(timestampMs, sortedTrims);
			const adjustedTimestampUs = audioData.timestamp - trimOffsetMs * 1000;

			const adjusted = this.cloneWithTimestamp(audioData, Math.max(0, adjustedTimestampUs));
			audioData.close();

			encoder.encode(adjusted);
			adjusted.close();
		}

		if (encoder.state === "configured") {
			await encoder.flush();
			encoder.close();
		}

		// Phase 3: Flush encoded chunks to muxer
		for (const { chunk, meta } of encodedChunks) {
			if (this.cancelled) break;
			await muxer.addAudioChunk(chunk, meta);
		}

		console.log(
			`[AudioProcessor] Processed ${decodedFrames.length} audio frames, encoded ${encodedChunks.length} chunks`,
		);
	}

	private cloneWithTimestamp(src: AudioData, newTimestamp: number): AudioData {
		const isPlanar = src.format?.includes("planar") ?? false;
		const numPlanes = isPlanar ? src.numberOfChannels : 1;

		let totalSize = 0;
		for (let p = 0; p < numPlanes; p++) {
			totalSize += src.allocationSize({ planeIndex: p });
		}

		const buffer = new ArrayBuffer(totalSize);
		let offset = 0;
		for (let p = 0; p < numPlanes; p++) {
			const planeSize = src.allocationSize({ planeIndex: p });
			src.copyTo(new Uint8Array(buffer, offset, planeSize), { planeIndex: p });
			offset += planeSize;
		}

		return new AudioData({
			format: src.format!,
			sampleRate: src.sampleRate,
			numberOfFrames: src.numberOfFrames,
			numberOfChannels: src.numberOfChannels,
			timestamp: newTimestamp,
			data: buffer,
		});
	}

	private isInTrimRegion(timestampMs: number, trims: TrimRegion[]): boolean {
		return trims.some((t) => timestampMs >= t.startMs && timestampMs < t.endMs);
	}

	private computeTrimOffset(timestampMs: number, trims: TrimRegion[]): number {
		let offset = 0;
		for (const trim of trims) {
			if (trim.endMs <= timestampMs) {
				offset += trim.endMs - trim.startMs;
			}
		}
		return offset;
	}

	cancel(): void {
		this.cancelled = true;
	}

	private async encodeEffectsOnlyTrack(
		muxer: VideoMuxer,
		keyboardEvents: KeyboardTelemetryEvent[],
		mouseClickEvents: MouseClickTelemetryEvent[],
		sounds: KeyboardSoundBuffers | undefined,
		mouseClickSound: ArrayBuffer | undefined,
		durationMs: number,
		trimRegions: TrimRegion[],
		speedRegions: SpeedRegion[],
	): Promise<void> {
		const sampleRate = 48_000;
		const channels = 2;
		const lengthFrames = Math.max(1, Math.ceil((durationMs / 1000) * sampleRate));
		const offline = new OfflineAudioContext(channels, lengthFrames, sampleRate);
		const timelineMap = this.buildSourceToExportMapper(trimRegions, speedRegions);

		const [keyBuffer, spaceBuffer, enterBuffer, clickBuffer] = await Promise.all([
			sounds ? offline.decodeAudioData(sounds.key.slice(0)) : Promise.resolve(null),
			sounds ? offline.decodeAudioData(sounds.space.slice(0)) : Promise.resolve(null),
			sounds ? offline.decodeAudioData(sounds.enter.slice(0)) : Promise.resolve(null),
			mouseClickSound ? offline.decodeAudioData(mouseClickSound.slice(0)) : Promise.resolve(null),
		]);

		const pickBuffer = (keyType: KeyboardTelemetryEvent["keyType"]) => {
			if (!keyBuffer || !spaceBuffer || !enterBuffer) return null;
			if (keyType === "space") return spaceBuffer;
			if (keyType === "enter") return enterBuffer;
			return keyBuffer;
		};

		for (let i = 0; i < keyboardEvents.length; i++) {
			const event = keyboardEvents[i];
			const mappedStartMs = timelineMap(event.timeMs);
			if (mappedStartMs === null || mappedStartMs > durationMs) continue;
			const startSec = Math.max(0, mappedStartMs) / 1000;
			let nextSec = Number.POSITIVE_INFINITY;
			for (let j = i + 1; j < keyboardEvents.length; j++) {
				const mappedNextMs = timelineMap(keyboardEvents[j].timeMs);
				if (mappedNextMs === null) continue;
				nextSec = Math.max(0, mappedNextMs) / 1000;
				break;
			}

			const source = offline.createBufferSource();
			const selected = pickBuffer(event.keyType);
			if (!selected) continue;
			source.buffer = selected;

			// Deterministic natural pitch variation.
			const seed = (event.timeMs * 9301 + (i + 1) * 49297) % 233280;
			const rand = seed / 233280;
			const jitter = (rand * 2 - 1) * 0.08;
			source.playbackRate.value = 1 + jitter;

			const gain = offline.createGain();
			const gainSeed = (event.timeMs * 6907 + (i + 3) * 31337) % 233280;
			const gainRand = gainSeed / 233280;
			const gainJitter = (gainRand * 2 - 1) * 0.08;
			gain.gain.value = Math.max(0.2, Math.min(0.46, 0.33 + gainJitter));
			source.connect(gain);
			gain.connect(offline.destination);
			source.start(startSec);
			if (Number.isFinite(nextSec) && nextSec > startSec + 0.0005) {
				source.stop(nextSec);
			}
		}

		if (clickBuffer) {
			for (let i = 0; i < mouseClickEvents.length; i++) {
				const event = mouseClickEvents[i];
				const mappedTimeMs = timelineMap(event.timeMs);
				if (mappedTimeMs === null || mappedTimeMs > durationMs) continue;
				const source = offline.createBufferSource();
				source.buffer = clickBuffer;
				const seed = (event.timeMs * 32749 + (i + 11) * 97) % 233280;
				const rand = seed / 233280;
				source.playbackRate.value = 1 + (rand * 2 - 1) * 0.045;
				const gain = offline.createGain();
				const gainSeed = (event.timeMs * 197 + (i + 5) * 7919) % 233280;
				const gainRand = gainSeed / 233280;
				gain.gain.value = Math.max(0.22, Math.min(0.5, 0.34 + (gainRand * 2 - 1) * 0.08));
				source.connect(gain);
				gain.connect(offline.destination);
				source.start(Math.max(0, mappedTimeMs) / 1000);
			}
		}

		const rendered = await offline.startRendering();
		const channelData: Float32Array[] = [];
		for (let c = 0; c < channels; c++) {
			channelData.push(new Float32Array(rendered.getChannelData(c)));
		}

		const encodeConfig: AudioEncoderConfig = {
			codec: "opus",
			sampleRate,
			numberOfChannels: channels,
			bitrate: AUDIO_BITRATE,
		};
		const support = await AudioEncoder.isConfigSupported(encodeConfig);
		if (!support.supported) {
			console.warn("[AudioProcessor] Opus encoding not supported for keyboard track");
			return;
		}

		const encodedChunks: { chunk: EncodedAudioChunk; meta?: EncodedAudioChunkMetadata }[] = [];
		const encoder = new AudioEncoder({
			output: (chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) => {
				encodedChunks.push({ chunk, meta });
			},
			error: (e: DOMException) => console.error("[AudioProcessor] Encode error:", e),
		});
		encoder.configure(encodeConfig);

		const totalFrames = channelData[0].length;
		for (let start = 0; start < totalFrames; start += OPUS_FRAME_SIZE) {
			if (this.cancelled) break;
			const frames = Math.min(OPUS_FRAME_SIZE, totalFrames - start);
			const data = new ArrayBuffer(frames * channels * Float32Array.BYTES_PER_ELEMENT);
			const view = new Float32Array(data);
			for (let c = 0; c < channels; c++) {
				view.set(channelData[c].subarray(start, start + frames), c * frames);
			}
			const timestamp = Math.round((start / sampleRate) * 1_000_000);
			const audioData = new AudioData({
				format: "f32-planar",
				sampleRate,
				numberOfFrames: frames,
				numberOfChannels: channels,
				timestamp,
				data,
			});
			encoder.encode(audioData);
			audioData.close();
		}

		if (encoder.state === "configured") {
			await encoder.flush();
			encoder.close();
		}

		for (const { chunk, meta } of encodedChunks) {
			if (this.cancelled) break;
			await muxer.addAudioChunk(chunk, meta);
		}
	}

	private buildSourceToExportMapper(trimRegions: TrimRegion[], speedRegions: SpeedRegion[]) {
		const keptSegments = this.computeKeptSegments(trimRegions);
		const timelineSegments = this.splitKeptSegmentsBySpeed(keptSegments, speedRegions);
		let runningMs = 0;
		const mappedSegments = timelineSegments.map((seg) => {
			const durationMs = (seg.endMs - seg.startMs) / seg.speed;
			const mapped = {
				...seg,
				outputStartMs: runningMs,
				outputEndMs: runningMs + durationMs,
			};
			runningMs += durationMs;
			return mapped;
		});

		return (sourceMs: number): number | null => {
			for (const seg of mappedSegments) {
				if (sourceMs < seg.startMs) {
					return null;
				}
				if (sourceMs >= seg.startMs && sourceMs < seg.endMs) {
					return seg.outputStartMs + (sourceMs - seg.startMs) / seg.speed;
				}
			}
			return null;
		};
	}

	private computeKeptSegments(
		trimRegions: TrimRegion[],
	): Array<{ startMs: number; endMs: number }> {
		if (trimRegions.length === 0) {
			return [{ startMs: 0, endMs: Number.POSITIVE_INFINITY }];
		}

		const segments: Array<{ startMs: number; endMs: number }> = [];
		let cursor = 0;
		for (const trim of trimRegions) {
			if (trim.startMs > cursor) {
				segments.push({ startMs: cursor, endMs: trim.startMs });
			}
			cursor = Math.max(cursor, trim.endMs);
		}
		segments.push({ startMs: cursor, endMs: Number.POSITIVE_INFINITY });
		return segments;
	}

	private splitKeptSegmentsBySpeed(
		segments: Array<{ startMs: number; endMs: number }>,
		speedRegions: SpeedRegion[],
	): Array<{ startMs: number; endMs: number; speed: number }> {
		if (speedRegions.length === 0) {
			return segments.map((seg) => ({ ...seg, speed: 1 }));
		}

		const result: Array<{ startMs: number; endMs: number; speed: number }> = [];
		for (const segment of segments) {
			const overlapping = speedRegions
				.filter((sr) => sr.startMs < segment.endMs && sr.endMs > segment.startMs)
				.sort((a, b) => a.startMs - b.startMs);

			if (overlapping.length === 0) {
				result.push({ ...segment, speed: 1 });
				continue;
			}

			let cursor = segment.startMs;
			for (const sr of overlapping) {
				const srStart = Math.max(sr.startMs, segment.startMs);
				const srEnd = Math.min(sr.endMs, segment.endMs);
				if (cursor < srStart) {
					result.push({ startMs: cursor, endMs: srStart, speed: 1 });
				}
				result.push({ startMs: srStart, endMs: srEnd, speed: sr.speed });
				cursor = srEnd;
			}

			if (cursor < segment.endMs) {
				result.push({ startMs: cursor, endMs: segment.endMs, speed: 1 });
			}
		}

		return result.filter((seg) => seg.endMs - seg.startMs > 0.0001);
	}
}
