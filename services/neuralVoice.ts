// Web fallback — sherpa-onnx is native-only. Native implementation: neuralVoice.native.ts.
import type { NeuralVoiceService } from './neuralVoice.types';

export * from './neuralVoice.types';

export const neuralVoice: NeuralVoiceService = {
  isSupported: () => false,
  isInstalled: () => false,
  install: () => Promise.reject(new Error('The neural voice is not available on web.')),
  cancelInstall: () => {},
  remove: async () => {},
  preload: async () => {},
  createStream: (options) => {
    queueMicrotask(() => options.onFail?.('The neural voice is not available on web.'));
    return { push: () => {}, end: () => {}, cancel: () => {} };
  },
  unload: async () => {},
};
