// Web fallback — ExecuTorch is native-only. Native implementation: localBrain.native.ts.
import type { LocalBrainService } from './localBrain.types';

export * from './localBrain.types';

const unavailable = () => Promise.reject(new Error('The on-device brain is not available on web.'));

export const localBrain: LocalBrainService = {
  isSupported: () => false,
  isInstalled: async () => false,
  install: unavailable,
  cancelInstall: () => {},
  remove: async () => {},
  warmUp: unavailable,
  generate: unavailable,
  stop: () => {},
  unload: () => {},
};
