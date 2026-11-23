import { Directory, File, Paths } from 'expo-file-system';
import type { StreamingTtsEngine, TtsStreamController } from 'react-native-sherpa-onnx/tts';

import { NEURAL_MODEL, type NeuralStream, type NeuralVoiceService } from './neuralVoice.types';

export * from './neuralVoice.types';

// sherpa-onnx's TurboModule is missing in Expo Go — require lazily so the app still runs there.
let ttsModule: typeof import('react-native-sherpa-onnx/tts') | null = null;
let extractModule: typeof import('react-native-sherpa-onnx/extraction') | null = null;
let sherpaRoot: typeof import('react-native-sherpa-onnx') | null = null;
try {
  ttsModule = require('react-native-sherpa-onnx/tts');
  extractModule = require('react-native-sherpa-onnx/extraction');
  sherpaRoot = require('react-native-sherpa-onnx');
} catch {
  ttsModule = null;
}

const UNAVAILABLE = 'sherpa-onnx native module unavailable — use a development build.';

// Not "kokoro": that folder name belongs to an older voice pack that removeLegacyDownloads deletes.
const root = new Directory(Paths.document, 'kokoro-voice');
const readyMarker = () => new File(root, '.ready');

/**
 * The model ships lexicons for US English, UK English and Chinese, and the native loader picks
 * the first one alphabetically (gb-en). Only US English is kept so she gets American pronunciation.
 */
const UNUSED_FILES = ['lexicon-gb-en.txt', 'lexicon-zh.txt'];

/** Audio goes to the player in short slices so a stop (barge-in) never waits behind a long write. */
const SLICE_SECONDS = 0.2;
/** Time for the audio still buffered in the player to come out of the speaker. */
const TAIL_MS = 300;

/** sherpa-onnx native code wants plain absolute paths, not file:// URIs. */
function toPath(uri: string) {
  return decodeURIComponent(uri.replace(/^file:\/\//, '')).replace(/\/$/, '');
}

function findModelDir(): Directory | null {
  if (!root.exists) return null;
  const sub = root.list().find((e) => e instanceof Directory && e.name.toLowerCase().includes(NEURAL_MODEL.folderHint));
  return (sub as Directory | undefined) ?? null;
}

let engine: StreamingTtsEngine | null = null;
let engineLoading: Promise<StreamingTtsEngine> | null = null;
let sampleRate = 24000;
let activeInstall: { cancel: () => void } | null = null;
let activeStream: NeuralStream | null = null;

/** Resolves once the previous stream has released the (single, shared) PCM player. */
let playerFree: Promise<void> = Promise.resolve();
/** Resolves once no native generation is running (the engine runs one at a time). */
let generationIdle: Promise<void> = Promise.resolve();

async function getEngine(): Promise<StreamingTtsEngine> {
  if (engine) return engine;
  if (engineLoading) return engineLoading;
  if (!ttsModule || !sherpaRoot) throw new Error(UNAVAILABLE);
  const dir = findModelDir();
  if (!dir) throw new Error('Neural voice not installed');
  engineLoading = ttsModule
    .createStreamingTTS({
      modelPath: sherpaRoot.fileModelPath(toPath(dir.uri)),
      modelType: 'kokoro',
      numThreads: 2,
      maxNumSentences: 1,
    })
    .then(async (e) => {
      sampleRate = (await e.getSampleRate().catch(() => 0)) || 24000;
      engine = e;
      return e;
    })
    .finally(() => {
      engineLoading = null;
    });
  return engineLoading;
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const neuralVoice: NeuralVoiceService = {
  isSupported: () => ttsModule !== null && extractModule !== null,

  isInstalled: () => readyMarker().exists && findModelDir() !== null,

  async install(onProgress) {
    if (!extractModule) throw new Error(UNAVAILABLE);
    await neuralVoice.unload();
    if (root.exists) root.delete();
    root.create({ intermediates: true });
    const archive = new File(Paths.cache, NEURAL_MODEL.archiveName);
    if (archive.exists) archive.delete();

    const task = File.createDownloadTask(NEURAL_MODEL.url, archive, {
      onProgress: ({ bytesWritten, totalBytes }) =>
        onProgress('downloading', bytesWritten / (totalBytes || NEURAL_MODEL.sizeBytes)),
    });
    activeInstall = { cancel: () => task.cancel() };
    try {
      const result = await task.downloadAsync();
      if (!result) throw new Error('Download cancelled');
      activeInstall = null;
      onProgress('extracting', 0);
      const extracted = await extractModule.extractArchive(
        {
          modelId: NEURAL_MODEL.archiveName.replace(/\.tar\.bz2$/, ''),
          archivePath: toPath(archive.uri),
          format: 'tar.bz2',
          fileSize: archive.size,
        },
        toPath(root.uri),
        { force: true, onProgress: (e) => onProgress('extracting', e.percent / 100) }
      );
      if (!extracted.success) throw new Error('Neural voice extraction was interrupted');
      const dir = findModelDir();
      if (!dir) throw new Error('Neural voice folder not found after extraction');
      for (const name of UNUSED_FILES) {
        const f = new File(dir, name);
        if (f.exists) f.delete();
      }
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
    await neuralVoice.unload();
    if (root.exists) root.delete();
  },

  async preload() {
    if (!neuralVoice.isInstalled()) return;
    await getEngine().catch((e) => console.warn('[kurisu] neural voice failed to load', e));
  },

  createStream(options) {
    const { sid, onStart, onDone, onFail } = options;
    const pitch = Math.max(0.8, Math.min(1.25, options.pitch));
    activeStream?.cancel();

    const texts: { text: string; speed: number }[] = [];
    const audio: number[][] = [];
    let e: StreamingTtsEngine | null = null;
    let controller: TtsStreamController | null = null;
    /** Ends the sentence being generated (exactly once). */
    let settleCurrent: (() => void) | null = null;
    let generating = false;
    let writing = false;
    let ended = false;
    let cancelled = false;
    let finishing = false;
    let finished = false;
    let started = false;

    // Claim the player; the next stream waits until this one has stopped it.
    const previousPlayer = playerFree;
    let releasePlayer!: () => void;
    playerFree = new Promise((r) => (releasePlayer = r));

    const startup = (async () => {
      await previousPlayer;
      if (cancelled || finished) return;
      const loaded = await getEngine();
      if (cancelled || finished) return;
      // Pitch: play the audio at a higher/lower sample rate. That also changes tempo, so each
      // sentence is synthesized at speed / pitch to compensate.
      await loaded.startPcmPlayer(Math.round(sampleRate * pitch), 1);
      e = loaded;
    })();

    const finish = (failure?: string) => {
      if (finished) return;
      finished = true;
      if (activeStream === stream) activeStream = null;
      // Stop the player only after startup settles, so a late startPcmPlayer can't outlive us.
      startup
        .catch(() => {})
        .then(() => e?.stopPcmPlayer())
        .catch(() => {})
        .then(releasePlayer);
      if (failure) onFail?.(failure);
      else onDone?.();
    };

    const checkDone = () => {
      if (finishing || finished || !ended || generating || writing || texts.length || audio.length) return;
      finishing = true;
      setTimeout(() => finish(), started ? TAIL_MS : 0);
    };

    const write = async () => {
      if (writing || !e) return;
      writing = true;
      while (audio.length && !cancelled) {
        const slice = audio.shift()!;
        if (!started) {
          started = true;
          onStart?.();
        }
        try {
          // Blocks (natively) until the player has room, so this loop runs at playback speed.
          await e.writePcmChunk(slice);
        } catch (err) {
          console.warn('[kurisu] neural voice playback failed', err);
          audio.length = 0;
          break;
        }
      }
      writing = false;
      checkDone();
    };

    const enqueue = (samples: number[]) => {
      const step = Math.round(sampleRate * SLICE_SECONDS);
      for (let i = 0; i < samples.length; i += step) audio.push(samples.slice(i, i + step));
      write();
    };

    const generate = async () => {
      if (cancelled || finished || !e || generating) return;
      const next = texts.shift();
      if (!next) return checkDone();
      generating = true;

      const previousGeneration = generationIdle;
      let markIdle!: () => void;
      generationIdle = new Promise((r) => (markIdle = r));
      const settle = () => {
        if (settleCurrent !== settle) return;
        settleCurrent = null;
        generating = false;
        controller = null;
        markIdle();
        generate();
      };
      settleCurrent = settle;

      await previousGeneration;
      // A cancelled generation can take a moment to wind down natively; retry while it does.
      for (let attempt = 0; !cancelled; attempt++) {
        try {
          controller = await e.generateSpeechStream(
            next.text,
            { sid, speed: next.speed },
            {
              onChunk: (chunk) => {
                if (!cancelled && chunk.samples.length) enqueue(chunk.samples);
              },
              onEnd: settle,
              onError: (err) => {
                console.warn('[kurisu] neural voice sentence failed', err.message);
                settle();
              },
            }
          );
          if (cancelled) {
            controller.cancel().catch(() => {});
            setTimeout(settle, 150);
          }
          return;
        } catch (err) {
          const busy = /in progress/i.test(err instanceof Error ? err.message : String(err));
          if (!busy || attempt >= 20) {
            console.warn('[kurisu] neural voice could not start a sentence', err);
            break;
          }
          await delay(100);
        }
      }
      settle();
    };

    const stream: NeuralStream = {
      push(text, speed) {
        if (finished || cancelled || ended) return;
        texts.push({ text, speed: Math.max(0.5, Math.min(2, speed / pitch)) });
        generate();
      },
      end() {
        ended = true;
        checkDone();
      },
      cancel() {
        if (finished) return;
        cancelled = true;
        texts.length = 0;
        audio.length = 0;
        const c = controller;
        const settle = settleCurrent;
        controller = null;
        if (c && settle) {
          // cancel() unsubscribes, so the native "end" event never arrives: free the engine for
          // the next stream after a short wind-down instead.
          c.cancel()
            .catch(() => {})
            .then(() => delay(150))
            .then(settle);
        }
        finish();
      },
    };
    activeStream = stream;

    startup.then(
      () => {
        if (!cancelled && !finished) generate();
      },
      (err) => finish(err instanceof Error ? err.message : String(err))
    );

    return stream;
  },

  async unload() {
    activeStream?.cancel();
    await playerFree;
    const e = engine;
    engine = null;
    await e?.destroy().catch(() => {});
  },
};
