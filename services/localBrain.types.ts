import type { GenerateOptions, GenerateResult } from './llm';

/**
 * Kurisu's on-device brain: Liquid AI's LFM2.5 1.2B Instruct, run by react-native-executorch
 * (ExecuTorch). It works offline and nothing leaves the phone. The model (~800 MB) is downloaded
 * once from Hugging Face on request in Settings.
 */
export const LOCAL_MODEL = {
  name: 'LFM2.5 1.2B',
  tagline: 'LIQUID AI · ON-DEVICE · EXECUTORCH · OFFLINE',
  /** Model + tokenizer files. iOS gets the MLX (Apple GPU) build, Android the XNNPACK (CPU) one. */
  sizeBytes: { ios: 895_331_422, android: 815_187_806 },
} as const;

export interface LocalBrainService {
  /** False on web / Expo Go (no ExecuTorch native module). */
  isSupported(): boolean;
  /** True when every model file is downloaded (checks the disk). */
  isInstalled(): Promise<boolean>;
  /** Downloads the model. Resumes a download that was cancelled or interrupted. */
  install(onProgress: (progress: number) => void): Promise<void>;
  cancelInstall(): void;
  /** Frees memory and deletes the model files. */
  remove(): Promise<void>;
  /** Loads the model into memory ahead of the first reply (optional; generate loads it too). */
  warmUp(): Promise<void>;
  /** Streams a reply to the conversation. */
  generate(options: GenerateOptions): Promise<GenerateResult>;
  /** Stops the reply that's generating (barge-in / the stop button). */
  stop(): void;
  /** Frees the model's memory (it reloads on the next reply). */
  unload(): void;
}
