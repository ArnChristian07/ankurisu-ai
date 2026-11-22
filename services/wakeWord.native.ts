import { Directory, File, Paths } from 'expo-file-system';
import type { PcmLiveStreamHandle } from 'react-native-sherpa-onnx/audio';
import type { StreamingSttEngine, SttStream } from 'react-native-sherpa-onnx/stt';

import { matchesWakePhrase, WAKE_MODEL, type WakeWordService } from './wakeWord.types';

export * from './wakeWord.types';

// sherpa-onnx's TurboModule is missing in Expo Go — require lazily so the app still runs there.
let sttModule: typeof import('react-native-sherpa-onnx/stt') | null = null;
let audioModule: typeof import('react-native-sherpa-onnx/audio') | null = null;
let extractModule: typeof import('react-native-sherpa-onnx/extraction') | null = null;
let sherpaRoot: typeof import('react-native-sherpa-onnx') | null = null;
try {
  sttModule = require('react-native-sherpa-onnx/stt');
  audioModule = require('react-native-sherpa-onnx/audio');
  extractModule = require('react-native-sherpa-onnx/extraction');
  sherpaRoot = require('react-native-sherpa-onnx');
} catch {
  sttModule = null;
}

const SAMPLE_RATE = 16000;
const root = new Directory(Paths.document, 'wake');
const readyMarker = () => new File(root, '.ready');

/** sherpa-onnx native code wants plain absolute paths, not file:// URIs. */
function toPath(uri: string) {
  return decodeURIComponent(uri.replace(/^file:\/\//, '')).replace(/\/$/, '');
}

function findModelDir(): Directory | null {
  if (!root.exists) return null;
  const sub = root.list().find((e) => e instanceof Directory && e.name.toLowerCase().includes(WAKE_MODEL.folderHint));
  return (sub as Directory | undefined) ?? null;
}

let engine: StreamingSttEngine | null = null;
let engineLoading: Promise<StreamingSttEngine> | null = null;
let activeInstall: { cancel: () => void } | null = null;
/** The one live listening session (the mic can only be opened once). */
let session: { stop: () => Promise<void> } | null = null;

async function getEngine(): Promise<StreamingSttEngine> {
  if (engine) return engine;
  if (engineLoading) return engineLoading;
  if (!sttModule || !sherpaRoot) throw new Error('sherpa-onnx native module unavailable — use a development build.');
  const dir = findModelDir();
  if (!dir) throw new Error('Wake word model not installed');
  engineLoading = sttModule
    .createStreamingSTT({
      modelPath: sherpaRoot.fileModelPath(toPath(dir.uri)),
      modelType: 'transducer',
      // One thread: it runs for minutes at a time, so battery matters more than latency here.
      numThreads: 1,
      enableEndpoint: true,
      // Cut utterances short so the transcript stays a few words long and matching stays cheap.
      endpointConfig: {
        rule1: { mustContainNonSilence: false, minTrailingSilence: 1.2, minUtteranceLength: 0 },
        rule2: { mustContainNonSilence: true, minTrailingSilence: 0.6, minUtteranceLength: 0 },
        rule3: { mustContainNonSilence: false, minTrailingSilence: 0, minUtteranceLength: 8 },
      },
    })
    .then((e) => {
      engine = e;
      return e;
    })
    .finally(() => {
      engineLoading = null;
    });
  return engineLoading;
}

export const wakeWord: WakeWordService = {
  isSupported: () => sttModule !== null && audioModule !== null,

  isInstalled: () => readyMarker().exists && findModelDir() !== null,

  async install(onProgress) {
    if (!extractModule) throw new Error('sherpa-onnx native module unavailable — use a development build.');
    await wakeWord.unload();
    if (root.exists) root.delete();
    root.create({ intermediates: true });
    const archive = new File(Paths.cache, WAKE_MODEL.archiveName);
    if (archive.exists) archive.delete();

    const task = File.createDownloadTask(WAKE_MODEL.url, archive, {
      onProgress: ({ bytesWritten, totalBytes }) =>
        onProgress('downloading', bytesWritten / (totalBytes || WAKE_MODEL.sizeBytes)),
    });
    activeInstall = { cancel: () => task.cancel() };
    try {
      const result = await task.downloadAsync();
      if (!result) throw new Error('Download cancelled');
      activeInstall = null;
      onProgress('extracting', 0);
      const extracted = await extractModule.extractArchive(
        {
          modelId: WAKE_MODEL.archiveName.replace(/\.tar\.bz2$/, ''),
          archivePath: toPath(archive.uri),
          format: 'tar.bz2',
          fileSize: archive.size,
        },
        toPath(root.uri),
        { force: true, onProgress: (e) => onProgress('extracting', e.percent / 100) }
      );
      if (!extracted.success) throw new Error('Wake word extraction was interrupted');
      const dir = findModelDir();
      if (!dir) throw new Error('Wake word model folder not found after extraction');
      // The sample recordings aren't needed on the phone.
      const wavs = new Directory(dir, 'test_wavs');
      if (wavs.exists) wavs.delete();
      readyMarker().write(new Date().toISOString());
    } catch (e) {
      if (root.exists) root.delete();
      throw e;
    } finally {
      activeInstall = null;
      if (archive.exists) archive.delete();
    }
  },

  cancelInstall() {
    activeInstall?.cancel();
  },

  async remove() {
    await wakeWord.unload();
    if (root.exists) root.delete();
  },

  async start(onWake, onError) {
    if (!audioModule) throw new Error('sherpa-onnx native module unavailable — use a development build.');
    await session?.stop();
    const e = await getEngine();
    const stream: SttStream = await e.createStream();
    const mic: PcmLiveStreamHandle = audioModule.createPcmLiveStream({
      sampleRate: SAMPLE_RATE,
      bufferSizeFrames: 1600, // 100 ms chunks
    });

    let stopped = false;
    let busy = false;
    // Audio that arrived while the previous chunk was still decoding (never dropped: the
    // streaming model needs continuous audio).
    let backlog: Float32Array[] = [];

    const stop = async () => {
      if (stopped) return;
      stopped = true;
      offData();
      offError();
      if (session?.stop === stop) session = null;
      await mic.stop().catch(() => {});
      await stream.release().catch(() => {});
    };

    const drain = async () => {
      if (busy || stopped || !backlog.length) return;
      busy = true;
      const total = backlog.reduce((n, b) => n + b.length, 0);
      const samples = new Float32Array(total);
      let offset = 0;
      for (const b of backlog) {
        samples.set(b, offset);
        offset += b.length;
      }
      backlog = [];
      try {
        const { result, isEndpoint } = await stream.processAudioChunk(samples, SAMPLE_RATE);
        if (stopped) return;
        // Dev builds: see how the model spells "Kurisu" on your voice, to tune WAKE_RE if needed.
        if (__DEV__ && isEndpoint && result.text.trim()) console.log('[kurisu] wake heard:', result.text);
        if (matchesWakePhrase(result.text)) {
          // Release the mic before handing over, or the speech recognizer can't open it.
          await stop();
          onWake();
          return;
        }
        if (isEndpoint) await stream.reset();
      } catch (err) {
        onError?.(err instanceof Error ? err.message : String(err));
      } finally {
        busy = false;
      }
      if (backlog.length) drain();
    };

    const offData = mic.onData((samples) => {
      if (stopped) return;
      backlog.push(samples);
      drain();
    });
    const offError = mic.onError((message) => {
      onError?.(message);
      stop();
    });

    session = { stop };
    try {
      await mic.start();
    } catch (err) {
      await stop();
      throw err;
    }
    return stop;
  },

  async unload() {
    await session?.stop();
    const e = engine;
    engine = null;
    await e?.destroy().catch(() => {});
  },
};
