/**
 * Neural voice: Kokoro v1.0 (int8) running on-device through sherpa-onnx. Far more expressive
 * than the system TTS, works offline, and the same native module already powers the wake word.
 */
export const NEURAL_MODEL = {
  name: 'Kokoro v1.0',
  url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-multi-lang-v1_0.tar.bz2',
  archiveName: 'kokoro-int8-multi-lang-v1_0.tar.bz2',
  sizeBytes: 132_353_410,
  folderHint: 'kokoro',
} as const;

export interface NeuralVoiceOption {
  /** Kokoro speaker name (stored in settings). */
  id: string;
  /** Speaker id inside the model (see the sherpa-onnx Kokoro v1.0 speaker table). */
  sid: number;
  label: string;
  hint: string;
}

/** Female speakers, roughly ordered by how well they suit an anime-dub heroine. */
export const NEURAL_VOICES: NeuralVoiceOption[] = [
  { id: 'af_heart', sid: 3, label: 'HEART', hint: 'Warm, clear, most natural' },
  { id: 'af_bella', sid: 2, label: 'BELLA', hint: 'Bright and lively' },
  { id: 'af_nicole', sid: 6, label: 'NICOLE', hint: 'Soft and breathy' },
  { id: 'af_sky', sid: 10, label: 'SKY', hint: 'Young and light' },
  { id: 'jf_alpha', sid: 37, label: 'ALPHA (JP)', hint: 'Japanese voice speaking English' },
  { id: 'jf_nezumi', sid: 39, label: 'NEZUMI (JP)', hint: 'Japanese voice, cute' },
  { id: 'jf_tebukuro', sid: 40, label: 'TEBUKURO (JP)', hint: 'Japanese voice, gentle' },
  { id: 'jf_gongitsune', sid: 38, label: 'GONGITSUNE (JP)', hint: 'Japanese voice, crisp' },
  { id: 'af_nova', sid: 7, label: 'NOVA', hint: 'Confident' },
  { id: 'af_jessica', sid: 4, label: 'JESSICA', hint: 'Casual' },
  { id: 'af_kore', sid: 5, label: 'KORE', hint: 'Steady' },
  { id: 'af_sarah', sid: 9, label: 'SARAH', hint: 'Mature' },
  { id: 'af_aoede', sid: 1, label: 'AOEDE', hint: 'Smooth' },
  { id: 'af_river', sid: 8, label: 'RIVER', hint: 'Calm' },
  { id: 'af_alloy', sid: 0, label: 'ALLOY', hint: 'Neutral' },
  { id: 'bf_lily', sid: 23, label: 'LILY (UK)', hint: 'British, young' },
  { id: 'bf_emma', sid: 21, label: 'EMMA (UK)', hint: 'British, poised' },
  { id: 'bf_isabella', sid: 22, label: 'ISABELLA (UK)', hint: 'British, warm' },
  { id: 'bf_alice', sid: 20, label: 'ALICE (UK)', hint: 'British, crisp' },
];

export const DEFAULT_NEURAL_VOICE = NEURAL_VOICES[0].id;

export function neuralVoiceById(id: string | undefined): NeuralVoiceOption {
  return NEURAL_VOICES.find((v) => v.id === id) ?? NEURAL_VOICES[0];
}

export interface NeuralSpeakOptions {
  /** Kokoro speaker id (NeuralVoiceOption.sid). */
  sid: number;
  /** Fixed for the whole stream: applied by playing the audio faster/slower (0.8–1.25). */
  pitch: number;
  onStart?: () => void;
  onDone?: () => void;
  /** The engine couldn't load or failed mid-stream; the caller should fall back to the system voice. */
  onFail?: (message: string) => void;
}

export interface NeuralStream {
  /** `speed` = 1 for normal tempo. */
  push(text: string, speed: number): void;
  end(): void;
  cancel(): void;
}

export interface NeuralVoiceService {
  /** False on web / Expo Go (no sherpa-onnx native module). */
  isSupported(): boolean;
  isInstalled(): boolean;
  install(onProgress: (phase: 'downloading' | 'extracting', progress: number) => void): Promise<void>;
  cancelInstall(): void;
  remove(): Promise<void>;
  /** Loads the model ahead of the first reply (optional; the first stream loads it too). */
  preload(): Promise<void>;
  createStream(options: NeuralSpeakOptions): NeuralStream;
  /** Frees the model's memory. */
  unload(): Promise<void>;
}
