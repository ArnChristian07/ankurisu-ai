/**
 * Shared contract for Kurisu's brain. The only brain is the on-device model in
 * services/localBrain.native.ts (react-native-executorch); nothing is sent to a cloud service.
 */
import { Platform } from 'react-native';

export type ChatTurn = { role: 'user' | 'assistant'; content: string };

export interface GenerateOptions {
  system: string;
  turns: ChatTurn[];
  /** Called with the whole reply so far, every time more text arrives. */
  onToken?: (accumulated: string) => void;
}

export interface GenerateResult {
  text: string;
  /** Output tokens per second (0 when unknown). */
  tokensPerSecond: number;
  /** Tokens in the prompt the model read for this reply. */
  promptTokens: number;
  /** Tokens the model wrote for this reply. */
  outputTokens: number;
  interrupted: boolean;
}

/** A failed reply, with a message that's safe to show the user. */
export class BrainError extends Error {
  constructor(
    message: string,
    readonly kind: 'unavailable' | 'server'
  ) {
    super(message);
  }
}

/**
 * Frees space and secrets left by removed features: the old llama-based brain (~640 MB in
 * documents/models), the neural voice packs (Kokoro / Kitten) and the Gemini API key that older
 * builds kept in the keystore. The wake-word model in documents/wake is kept.
 * Native only; never throws.
 */
const LEGACY_DIRS = ['models', 'tts', 'voices', 'voice-packs', 'voicepacks', 'neural', 'kokoro', 'kitten'];
const LEGACY_KEY = 'ankurisu.gemini-key';

export function removeLegacyDownloads(): void {
  if (Platform.OS === 'web') return;
  try {
    const SecureStore: typeof import('expo-secure-store') = require('expo-secure-store');
    SecureStore.deleteItemAsync(LEGACY_KEY).catch(() => {});
  } catch {
    // module unavailable
  }
  let fs: typeof import('expo-file-system');
  try {
    fs = require('expo-file-system');
  } catch {
    return;
  }
  for (const name of LEGACY_DIRS) {
    try {
      const dir = new fs.Directory(fs.Paths.document, name);
      if (dir.exists) dir.delete();
    } catch (e) {
      console.warn('[kurisu] could not remove old download', name, e);
    }
  }
}
