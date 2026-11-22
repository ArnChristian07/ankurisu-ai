/**
 * "Hey Kurisu" wake word: a tiny streaming transducer (sherpa-onnx's 3.3M zipformer KWS model)
 * transcribes the mic continuously while the voice link is idle, and a fuzzy match on the
 * transcript wakes her. Fully on-device; nothing is recorded or stored.
 */
export const WAKE_MODEL = {
  name: 'Zipformer 3.3M',
  url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01.tar.bz2',
  archiveName: 'sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01.tar.bz2',
  sizeBytes: 17_626_723,
  folderHint: 'kws-zipformer',
} as const;

/**
 * How an English acoustic model hears "Kurisu" — it has never seen the name, so it spells it
 * phonetically. Transcripts are upper-case BPE output, e.g. "HEY CHRIS SUE", "KURI SU", "CURRY SOON".
 */
const NAME = String.raw`(?:KU?RR?E{0,2}I?\s?SU[EH]?|KU?RI+\s?SOO?N?|CH?RIS+\s?S?U[EH]?|CURR?Y\s?SU[EH]?|CREE?\s?SU[EH]?|KRISU|KURISU|CHRISTINA)`;
const WAKE_RE = new RegExp(String.raw`\b(?:(?:HEY|HI|OK|OKAY|A)\s+)?${NAME}\b`);

export function matchesWakePhrase(transcript: string): boolean {
  return WAKE_RE.test(transcript.toUpperCase().replace(/[^A-Z' ]/g, ' ').replace(/\s+/g, ' '));
}

export interface WakeWordService {
  /** False on web / Expo Go (no sherpa-onnx native module). */
  isSupported(): boolean;
  isInstalled(): boolean;
  install(onProgress: (phase: 'downloading' | 'extracting', progress: number) => void): Promise<void>;
  cancelInstall(): void;
  remove(): Promise<void>;
  /**
   * Starts listening for the wake phrase. When heard, the mic is released first and then
   * `onWake` fires, so the regular speech recognizer can take over the microphone.
   * Resolves to a stop function.
   */
  start(onWake: () => void, onError?: (message: string) => void): Promise<() => Promise<void>>;
  /** Frees the recognizer (call when the voice link closes). */
  unload(): Promise<void>;
}
