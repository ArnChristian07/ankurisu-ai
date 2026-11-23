/**
 * On-device brain (see localBrain.types.ts): LFM2.5 1.2B through react-native-executorch.
 *
 * Speed matters more than anything in a voice call, so instead of the library's chat session
 * (which wants an append-only history) this drives the low-level runner and reuses the KV cache
 * itself: the ~1.5k-token system prompt is prefilled once and kept, and each reply only prefills
 * the turns that changed since the last one.
 */
import type RNBlobUtilType from 'react-native-blob-util';
import type { LLMModel, llm as LlmNs } from 'react-native-executorch';
import { scheduleOnRN } from 'react-native-worklets';

import { BrainError, type ChatTurn, type GenerateOptions, type GenerateResult } from './llm';
import { loadJSON, saveJSON } from './storage';
import type { LocalBrainService } from './localBrain.types';

export * from './localBrain.types';

type ET = typeof import('react-native-executorch');
type LLMRunner = LlmNs.LLMRunner;
type ChatPreprocessor = LlmNs.ChatPreprocessor;
type ChatMessage = LlmNs.ChatMessage;
type LLMGenerationConfig = LlmNs.LLMGenerationConfig;
type LLMGenerationStats = LlmNs.LLMGenerationStats;

// ExecuTorch's native module is missing in Expo Go — require lazily so the app still runs there.
// Same for blob-util: a static import throws at launch when the installed build predates it.
let et: ET | null = null;
let RNBlobUtil: typeof RNBlobUtilType = null as unknown as typeof RNBlobUtilType;
try {
  RNBlobUtil = require('react-native-blob-util').default as typeof RNBlobUtilType;
  et = require('react-native-executorch') as ET;
  // Model downloads ping an anonymous counter by default; this app keeps everything private.
  et.setTelemetryEnabled(false);
} catch {
  et = null;
}

/** Picked per platform by the library: MLX on iPhone, XNNPACK on Android. */
const REMOTE: LLMModel | null = et ? et.models.llm.LFM2_5_1_2B.DEFAULT : null;

const STORE_KEY = 'ankurisu.local-brain.v1';
type Installed = { source: string; files: LLMModel };

const GENERATION: LLMGenerationConfig = {
  // Replies are 1-3 spoken sentences plus an optional NOTE/ACTION line.
  maxNewTokens: 320,
  temperature: 0.4,
  topP: 0.9,
  minP: 0.05,
  repetitionPenalty: 1.05,
};
/** Room kept free in the context window for her reply and template tokens. */
const RESERVED_TOKENS = GENERATION.maxNewTokens! + 96;

/* ── Install ────────────────────────────────────────────────────────────────────────────── */

let installController: AbortController | null = null;

async function installedFiles(): Promise<LLMModel | null> {
  if (!REMOTE) return null;
  const saved = await loadJSON<Installed>(STORE_KEY);
  if (!saved || saved.source !== REMOTE.modelPath) return null;
  const { modelPath, tokenizerPath, tokenizerConfigPath } = saved.files;
  const present = await Promise.all(
    [modelPath, tokenizerPath, tokenizerConfigPath].map((p) => RNBlobUtil.fs.exists(p).catch(() => false))
  );
  return present.every(Boolean) ? saved.files : null;
}

/* ── Engine ─────────────────────────────────────────────────────────────────────────────── */

interface Engine {
  runner: LLMRunner;
  pre: ChatPreprocessor;
  stopTokens: readonly string[];
  maxContext: number;
  /** Messages whose tokens are in the KV cache, in order. */
  committed: ChatMessage[];
  /** KV positions where a prefix of `committed` ends: { first `count` messages → `pos` }. */
  checkpoints: { count: number; pos: number }[];
}

let engine: Engine | null = null;
let engineLoading: Promise<Engine> | null = null;

async function getEngine(): Promise<Engine> {
  if (engine) return engine;
  if (engineLoading) return engineLoading;
  if (!et) throw new BrainError('ExecuTorch is unavailable — use a development build.', 'unavailable');
  const lib = et;
  engineLoading = (async () => {
    const files = await installedFiles();
    if (!files) throw new BrainError('The on-device model is not downloaded.', 'unavailable');
    const config = lib.llm.parseTokenizerConfig(JSON.parse(await RNBlobUtil.fs.readFile(files.tokenizerConfigPath, 'utf8')));
    const runner = await lib.llm.createLLMRunner(files.modelPath, files.tokenizerPath);
    const pre = lib.llm.createChatPreprocessor({
      chatTemplate: config.chatTemplate,
      bosToken: config.bosToken,
      eosToken: config.eosToken,
    });
    engine = {
      runner,
      pre,
      stopTokens: config.stopTokens,
      maxContext: runner.getKVCacheState().maxContextLen,
      committed: [],
      checkpoints: [],
    };
    return engine;
  })().finally(() => {
    engineLoading = null;
  });
  return engineLoading;
}

/** Decode loop, run on ExecuTorch's worklet thread; streams the text so far back to JS. */
function generateWorklet(
  runner: LLMRunner,
  prompt: LlmNs.Prompt,
  config: LLMGenerationConfig,
  stopTokens: readonly string[],
  onText: (text: string) => void
): { text: string; stats: LLMGenerationStats } {
  'worklet';
  let text = '';
  const stats = runner.generate(prompt, config, (token: string) => {
    if (stopTokens.includes(token)) return;
    text += token;
    scheduleOnRN(onText, text);
  });
  return { text, stats };
}

/**
 * The chat template needs user-first, alternating turns. The stored log starts with her greeting
 * and can hold two user lines in a row (a reply that failed), so merge runs.
 */
function toMessages(system: string, turns: ChatTurn[]): ChatMessage[] {
  const out: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const t of turns) {
    if (!out.length && t.role === 'assistant') continue;
    const last = out[out.length - 1];
    if (last?.role === t.role) last.content += `\n\n${t.content}`;
    else out.push({ role: t.role, content: t.content });
  }
  return [{ role: 'system', content: system }, ...out];
}

/** Rough token count (LFM's tokenizer averages ~3.5-4 chars per token on English text). */
const estimateTokens = (m: ChatMessage) => Math.ceil(String(m.content ?? '').length / 3) + 6;

/** Drops the oldest exchanges until the prompt fits the model's context window. */
function fitContext(messages: ChatMessage[], maxContext: number): ChatMessage[] {
  const budget = maxContext - RESERVED_TOKENS;
  const fitted = [...messages];
  let total = fitted.reduce((n, m) => n + estimateTokens(m), 0);
  while (total > budget && fitted.length > 2) {
    total -= estimateTokens(fitted.splice(1, 1)[0]);
    // Keep the history user-first after trimming.
    while (fitted.length > 2 && fitted[1].role !== 'user') total -= estimateTokens(fitted.splice(1, 1)[0]);
  }
  return fitted;
}

function sameMessage(a: ChatMessage, b: ChatMessage) {
  return a.role === b.role && a.content === b.content;
}

/**
 * Brings the KV cache to "all of `messages` prefilled", reusing the longest cached prefix.
 * Returns the KV position at the end of the last message.
 */
async function prefillConversation(e: Engine, messages: ChatMessage[]): Promise<number> {
  const prefill = et!.wrapAsync(e.runner.prefill);
  let common = 0;
  while (common < e.committed.length && common < messages.length && sameMessage(e.committed[common], messages[common])) {
    common++;
  }
  const kept = e.checkpoints.filter((c) => c.count <= common);
  let start = kept[kept.length - 1] ?? { count: 0, pos: 0 };

  const run = async (from: { count: number; pos: number }) => {
    e.runner.reset(from.pos);
    const checkpoints = e.checkpoints.filter((c) => c.count <= from.count);
    let count = from.count;
    if (count === 0) {
      // The system prompt gets its own checkpoint: it survives history changes.
      await prefill(e.pre.process(messages.slice(0, 1), 1, { addGenPrompt: false }));
      e.pre.clear();
      count = 1;
      checkpoints.push({ count, pos: e.runner.getKVCacheState().pos });
    }
    if (count < messages.length) {
      await prefill(e.pre.process(messages, messages.length - count, { addGenPrompt: false }));
      e.pre.clear();
    }
    const pos = e.runner.getKVCacheState().pos;
    if (count < messages.length) checkpoints.push({ count: messages.length, pos });
    // Keep the system checkpoint and the newest one; that's all later turns can reuse.
    e.checkpoints = checkpoints.length > 2 ? [checkpoints[0], checkpoints[checkpoints.length - 1]] : checkpoints;
    e.committed = messages;
    return pos;
  };

  try {
    return await run(start);
  } catch (err) {
    e.pre.clear();
    if (start.count === 0) throw err;
    // A template quirk made the cached prefix unusable: start over from an empty cache.
    e.checkpoints = [];
    e.committed = [];
    start = { count: 0, pos: 0 };
    return run(start);
  }
}

let active: { stopped: boolean; done: Promise<unknown> } | null = null;

async function generate({ system, turns, onToken }: GenerateOptions): Promise<GenerateResult> {
  // Barge-in can start a new reply while the old one is still unwinding on the worklet thread.
  if (active) {
    localBrain.stop();
    await active.done.catch(() => {});
  }
  const job: { stopped: boolean; done: Promise<unknown> } = { stopped: false, done: Promise.resolve() };
  active = job;

  const work = (async (): Promise<GenerateResult> => {
    let e: Engine;
    try {
      e = await getEngine();
    } catch (err) {
      throw err instanceof BrainError ? err : new BrainError(`Couldn't load the on-device model: ${String(err)}`, 'server');
    }
    if (job.stopped) return emptyResult(true);

    const messages = fitContext(toMessages(system, turns), e.maxContext);
    let posAtEndOfUser = -1;
    try {
      posAtEndOfUser = await prefillConversation(e, messages);
      if (job.stopped) return emptyResult(true);

      const prompt = e.pre.process(messages, 0, { addGenPrompt: true });
      const { text, stats } = await et!.wrapAsync(generateWorklet)(e.runner, prompt, GENERATION, e.stopTokens, (acc) => {
        if (!job.stopped) onToken?.(acc);
      });
      e.pre.clear();
      onToken?.(text);
      return {
        text,
        tokensPerSecond: stats.tokensPerSecond,
        promptTokens: Math.max(0, posAtEndOfUser),
        outputTokens: stats.numTokens,
        interrupted: job.stopped,
      };
    } catch (err) {
      // Unknown cache state after a failure: rebuild it next time.
      e.committed = [];
      e.checkpoints = [];
      if (job.stopped) return emptyResult(true);
      throw new BrainError(`On-device generation failed: ${err instanceof Error ? err.message : String(err)}`, 'server');
    } finally {
      // Drop her generated tokens from the cache; the next turn prefills the cleaned-up reply.
      if (engine === e && posAtEndOfUser >= 0 && e.committed.length) e.runner.reset(posAtEndOfUser);
    }
  })();

  job.done = work;
  try {
    return await work;
  } finally {
    if (active === job) active = null;
  }
}

function emptyResult(interrupted: boolean): GenerateResult {
  return { text: '', tokensPerSecond: 0, promptTokens: 0, outputTokens: 0, interrupted };
}

function unload() {
  const e = engine;
  engine = null;
  if (!e) return;
  e.runner.stop();
  e.pre.dispose();
  e.runner.dispose();
}

export const localBrain: LocalBrainService = {
  isSupported: () => et !== null,

  isInstalled: async () => (await installedFiles()) !== null,

  async install(onProgress) {
    if (!et || !REMOTE) throw new Error('ExecuTorch is unavailable — use a development build.');
    installController?.abort();
    const controller = new AbortController();
    installController = controller;
    try {
      // Cached files resolve instantly; partial ones resume where they stopped.
      const files = await et.download(REMOTE, { signal: controller.signal, onProgress });
      saveJSON(STORE_KEY, { source: REMOTE.modelPath, files } satisfies Installed);
    } catch (e) {
      if (controller.signal.aborted || et.isRnExecuTorchError(e, 'DOWNLOAD_ABORTED')) {
        throw new Error('Download cancelled');
      }
      throw e;
    } finally {
      if (installController === controller) installController = null;
    }
  },

  cancelInstall() {
    installController?.abort();
  },

  async remove() {
    localBrain.stop();
    await active?.done.catch(() => {});
    unload();
    const saved = await loadJSON<Installed>(STORE_KEY);
    saveJSON(STORE_KEY, null);
    if (!saved || !et) return;
    const { modelPath, tokenizerPath, tokenizerConfigPath } = saved.files;
    await Promise.all(
      [modelPath, tokenizerPath, tokenizerConfigPath].map((p) => RNBlobUtil.fs.unlink(p).catch(() => {}))
    );
  },

  async warmUp() {
    await getEngine();
  },

  generate,

  stop() {
    if (!active) return;
    active.stopped = true;
    engine?.runner.stop();
  },

  unload,
};
