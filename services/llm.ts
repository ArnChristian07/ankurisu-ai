/**
 * Kurisu's brain: Google Gemini over the REST API, streamed with Server-Sent Events.
 *
 * - The user pastes their own Gemini API key in Settings. It's kept in the OS keystore
 *   (expo-secure-store) and never ships inside the app.
 * - With web search on, Gemini grounds answers with Google Search by itself, so the app needs no
 *   lookup code of its own.
 * - `expo/fetch` is used because React Native's built-in fetch can't stream a response body.
 */
import { fetch } from 'expo/fetch';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { BRAIN_MODEL } from '@/constants/models';
import { loadJSON, saveJSON } from '@/services/storage';

export type ChatTurn = { role: 'user' | 'assistant'; content: string };

export interface GenerateOptions {
  system: string;
  turns: ChatTurn[];
  /** Let Gemini search Google before answering (current events, people, facts it's unsure of). */
  webSearch: boolean;
  /** Called with the whole reply so far, every time more text arrives. */
  onToken?: (accumulated: string) => void;
}

export interface GenerateResult {
  text: string;
  /** Output tokens per second after the first token (0 when unknown). */
  tokensPerSecond: number;
  /** Tokens in the prompt Gemini read for this reply. */
  promptTokens: number;
  /** Tokens Gemini wrote for this reply. */
  outputTokens: number;
  interrupted: boolean;
  /** Google searches Gemini ran for this reply. */
  searches: string[];
}

/** A request Gemini rejected, with a message that's safe to show the user. */
export class BrainError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'quota' | 'network' | 'server' | 'blocked'
  ) {
    super(message);
  }
}

const API = 'https://generativelanguage.googleapis.com/v1beta';
const KEY_NAME = 'ankurisu.gemini-key'; // SecureStore keys: letters, digits, ".", "-", "_"
const WEB_KEY_NAME = 'ankurisu.gemini-key.v1';

/* ── API key ────────────────────────────────────────────────────────────────────────────── */

let cachedKey: string | null | undefined;

/**
 * Developer key from .env.local (EXPO_PUBLIC_GEMINI_API_KEY), used when no key was saved in
 * Settings. Expo inlines EXPO_PUBLIC_ variables into the bundle at build time.
 */
const ENV_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY?.trim() || null;

/** True when the key in use comes from the .env file, not from Settings. */
export const usingEnvKey = () => !cachedKey && !!ENV_KEY;

export async function getApiKey(): Promise<string | null> {
  if (cachedKey !== undefined) return cachedKey ?? ENV_KEY;
  try {
    // SecureStore has no web implementation; the web build is for development only.
    cachedKey =
      Platform.OS === 'web' ? await loadJSON<string>(WEB_KEY_NAME) : await SecureStore.getItemAsync(KEY_NAME);
  } catch {
    cachedKey = null;
  }
  // A key saved in Settings wins over the .env one.
  return cachedKey ?? ENV_KEY;
}

export async function setApiKey(key: string | null): Promise<void> {
  const value = key?.trim() || null;
  if (Platform.OS === 'web') {
    saveJSON(WEB_KEY_NAME, value);
  } else if (value) {
    await SecureStore.setItemAsync(KEY_NAME, value);
  } else {
    await SecureStore.deleteItemAsync(KEY_NAME);
  }
  cachedKey = value;
}

function errorFor(status: number, detail: string): BrainError {
  if (status === 400 && /api key/i.test(detail)) return new BrainError('That API key was rejected.', 'auth');
  if (status === 401 || status === 403) return new BrainError('That API key was rejected.', 'auth');
  if (status === 429) return new BrainError('Gemini quota or rate limit reached. Try again later.', 'quota');
  if (status >= 500) return new BrainError(`Gemini is having problems (HTTP ${status}).`, 'server');
  return new BrainError(detail || `Gemini request failed (HTTP ${status}).`, 'server');
}

async function readError(res: Response): Promise<BrainError> {
  let detail = '';
  try {
    const body = await res.json();
    detail = body?.error?.message ?? '';
  } catch {
    // not JSON
  }
  return errorFor(res.status, detail);
}

/** Checks the key against the model's metadata endpoint (free, no tokens used). */
export async function verifyApiKey(key: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API}/models/${BRAIN_MODEL.id}`, { headers: { 'x-goog-api-key': key.trim() } });
  } catch {
    throw new BrainError('No connection to Gemini.', 'network');
  }
  if (!res.ok) throw await readError(res);
}

/* ── Generation ─────────────────────────────────────────────────────────────────────────── */

/**
 * Gemini wants turns that start with the user and alternate user/model. The stored log starts
 * with her greeting and can hold two user lines in a row (a reply that failed), so merge runs.
 */
function toContents(turns: ChatTurn[]) {
  const out: { role: 'user' | 'model'; parts: { text: string }[] }[] = [];
  for (const t of turns) {
    const role = t.role === 'assistant' ? 'model' : 'user';
    if (!out.length && role === 'model') continue;
    const last = out[out.length - 1];
    if (last?.role === role) last.parts[0].text += `\n\n${t.content}`;
    else out.push({ role, parts: [{ text: t.content }] });
  }
  return out;
}

type StreamChunk = {
  candidates?: {
    content?: { parts?: { text?: string; thought?: boolean }[] };
    finishReason?: string;
    groundingMetadata?: { webSearchQueries?: string[] };
  }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  promptFeedback?: { blockReason?: string };
};

let active: { controller: AbortController; reader?: ReadableStreamDefaultReader<Uint8Array> } | null = null;

export async function generate({ system, turns, webSearch, onToken }: GenerateOptions): Promise<GenerateResult> {
  const key = await getApiKey();
  if (!key) throw new BrainError('No Gemini API key set.', 'auth');

  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: toContents(turns),
    ...(webSearch ? { tools: [{ google_search: {} }] } : {}),
    generationConfig: {
      // Token saver: replies are 1-3 spoken sentences (+ an optional NOTE/ACTION line), and a
      // detailed explanation still fits. Thinking tokens count toward this cap too.
      maxOutputTokens: 400,
      // Lowest-latency setting: she's in a live voice call, not solving proofs.
      thinkingConfig: { thinkingLevel: BRAIN_MODEL.thinkingLevel },
    },
  };

  const controller = new AbortController();
  const job: NonNullable<typeof active> = { controller };
  active = job;

  let res: Response;
  try {
    res = await fetch(`${API}/models/${BRAIN_MODEL.id}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key, Accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    if (active === job) active = null;
    if (controller.signal.aborted) return emptyResult(true);
    throw new BrainError('No connection to Gemini.', 'network');
  }
  if (!res.ok || !res.body) {
    if (active === job) active = null;
    throw res.ok ? new BrainError('Gemini sent an empty response.', 'server') : await readError(res);
  }

  const reader = res.body.getReader();
  job.reader = reader;
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let promptTokens = 0;
  let outputTokens = 0;
  let firstTokenAt = 0;
  let blocked = '';
  const searches = new Set<string>();

  const handle = (data: string) => {
    let chunk: StreamChunk;
    try {
      chunk = JSON.parse(data);
    } catch {
      return;
    }
    if (chunk.promptFeedback?.blockReason) blocked = chunk.promptFeedback.blockReason;
    const cand = chunk.candidates?.[0];
    for (const q of cand?.groundingMetadata?.webSearchQueries ?? []) searches.add(q);
    if (cand?.finishReason === 'SAFETY' || cand?.finishReason === 'PROHIBITED_CONTENT') blocked = cand.finishReason;
    // Thought parts are the model's reasoning, never part of her reply.
    const piece = (cand?.content?.parts ?? [])
      .filter((p) => !p.thought && p.text)
      .map((p) => p.text)
      .join('');
    if (piece) {
      if (!firstTokenAt) firstTokenAt = Date.now();
      text += piece;
      onToken?.(text);
    }
    if (chunk.usageMetadata) {
      promptTokens = chunk.usageMetadata.promptTokenCount ?? promptTokens;
      outputTokens = chunk.usageMetadata.candidatesTokenCount ?? outputTokens;
    }
  };

  let interrupted = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE events are separated by a blank line; each carries one "data: {json}" payload.
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? '';
      for (const ev of events) {
        const data = ev
          .split(/\r?\n/)
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim())
          .join('');
        if (data) handle(data);
      }
    }
    if (buffer.trim().startsWith('data:')) handle(buffer.trim().slice(5).trim());
  } catch (e) {
    if (!controller.signal.aborted) throw new BrainError('The connection to Gemini dropped.', 'network');
    interrupted = true;
  } finally {
    if (active === job) active = null;
  }
  if (controller.signal.aborted) interrupted = true;
  if (blocked && !text) throw new BrainError(`Gemini blocked this reply (${blocked}).`, 'blocked');

  const seconds = firstTokenAt ? (Date.now() - firstTokenAt) / 1000 : 0;
  return {
    text,
    tokensPerSecond: seconds > 0.2 && outputTokens ? outputTokens / seconds : 0,
    promptTokens,
    outputTokens,
    interrupted,
    searches: [...searches],
  };
}

function emptyResult(interrupted: boolean): GenerateResult {
  return { text: '', tokensPerSecond: 0, promptTokens: 0, outputTokens: 0, interrupted, searches: [] };
}

/** Stops the reply that's streaming (barge-in / the stop button). */
export function stop(): void {
  const job = active;
  if (!job) return;
  job.controller.abort();
  job.reader?.cancel().catch(() => {});
}

/**
 * Frees space used by removed features: the old on-device brain (~640 MB in documents/models)
 * and the neural voice packs (Kokoro / Kitten). The wake-word model in documents/wake is kept.
 * Native only; never throws.
 */
const LEGACY_DIRS = ['models', 'tts', 'voices', 'voice-packs', 'voicepacks', 'neural', 'kokoro', 'kitten'];

export function removeLegacyDownloads(): void {
  if (Platform.OS === 'web') return;
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
