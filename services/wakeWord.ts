// Web fallback — sherpa-onnx is native-only. Native implementation: wakeWord.native.ts.
import type { WakeWordService } from './wakeWord.types';

export * from './wakeWord.types';

export const wakeWord: WakeWordService = {
  isSupported: () => false,
  isInstalled: () => false,
  install: () => Promise.reject(new Error('The wake word is not available on web.')),
  cancelInstall: () => {},
  remove: async () => {},
  start: async () => async () => {},
  unload: async () => {},
};
