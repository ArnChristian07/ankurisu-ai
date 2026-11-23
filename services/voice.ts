import * as Speech from 'expo-speech';
import { Platform } from 'react-native';

import type { KurisuMood } from '@/constants/sprites';
import type { LanguageOption } from '@/context/AppContext';
import { neuralVoice, type NeuralStream } from '@/services/neuralVoice';

/* ──────────────────────────────  TTS  ────────────────────────────── */

/** Platform "normal" speaking rate — iOS uses a different scale (0.5 ≈ normal). */
const BASE_RATE = Platform.OS === 'ios' ? 0.52 : 1.02;

/**
 * User-tunable voice character. Applied on top of the per-mood prosody below.
 * - pitch: 1 = the voice's natural pitch.
 * - rate: 1 = normal speaking speed.
 * - expression: how strongly her mood bends pitch and speed (0 = flat/monotone, 1 = default, 2 = very animated).
 */
export interface VoiceTune {
  pitch: number;
  rate: number;
  expression: number;
}

export const VOICE_TUNE_LIMITS = {
  pitch: { min: 0.5, max: 2 },
  rate: { min: 0.5, max: 1.6 },
  expression: { min: 0, max: 2 },
} as const;

/** Kurisu's default: a young, clear, slightly bright voice. */
export const DEFAULT_TUNE: VoiceTune = { pitch: 1.1, rate: 1.0, expression: 1.0 };

/** Starting points for dialing in a character voice — then fine-tune with the sliders. */
export const TUNE_PRESETS: { id: string; label: string; tune: VoiceTune }[] = [
  { id: 'kurisu', label: 'KURISU', tune: DEFAULT_TUNE },
  { id: 'tsundere', label: 'TSUNDERE', tune: { pitch: 1.2, rate: 1.08, expression: 1.5 } },
  { id: 'cute', label: 'CUTE', tune: { pitch: 1.4, rate: 1.04, expression: 1.3 } },
  { id: 'cool', label: 'COOL', tune: { pitch: 0.95, rate: 0.97, expression: 0.6 } },
  { id: 'calm', label: 'CALM', tune: { pitch: 1.0, rate: 0.9, expression: 0.4 } },
];

const clampTo = (n: number, { min, max }: { min: number; max: number }) => Math.max(min, Math.min(max, n));

const MOOD_PROSODY: Record<KurisuMood, { pitch: number; rate: number }> = {
  happy: { pitch: 1.04, rate: 1.0 },
  curious: { pitch: 1.03, rate: 0.98 },
  flustered: { pitch: 1.12, rate: 1.12 },
  confident: { pitch: 0.98, rate: 1.03 },
  explaining: { pitch: 0.97, rate: 1.0 },
  neutral: { pitch: 1.0, rate: 1.0 },
  sad: { pitch: 0.92, rate: 0.88 },
  serious: { pitch: 0.93, rate: 0.95 },
  shocked: { pitch: 1.15, rate: 1.1 },
  shy: { pitch: 1.08, rate: 0.92 },
  angry: { pitch: 1.06, rate: 1.1 },
  smug: { pitch: 0.99, rate: 0.96 },
  excited: { pitch: 1.14, rate: 1.12 },
  sleepy: { pitch: 0.94, rate: 0.84 },
  laughing: { pitch: 1.1, rate: 1.05 },
  pouting: { pitch: 1.05, rate: 0.93 },
};

export interface VoiceOption {
  identifier: string;
  name: string;
  language: string;
  enhanced: boolean;
}

// Voices known to sound young/female. Android Google TTS ids + iOS voice names.
const PREFERRED_FEMALE = [
  // Android (Google TTS) — "-local" works offline
  'en-us-x-tpf-local',
  'en-us-x-sfg-local',
  'en-us-x-iog-local',
  'en-us-x-tpc-local',
  'fil-ph-x-fie-local',
  'fil-ph-x-cfc-local',
  // iOS
  'zoe',
  'ava',
  'nicky',
  'samantha',
  'allison',
  'susan',
  'karen',
];

const MALE_HINTS = /\b(male|iol|iom|tpd|alex|daniel|fred|tom|aaron|arthur|gordon|rishi|reed|eddy|grandpa|ralph)\b/i;

function localeFor(language: LanguageOption): string {
  return language === 'English' ? 'en-US' : 'fil-PH';
}

function scoreVoice(v: Speech.Voice, lang: string): number {
  const id = `${v.identifier} ${v.name}`.toLowerCase();
  let score = 0;
  const vLang = v.language.toLowerCase().replace('_', '-');
  if (vLang === lang.toLowerCase()) score += 50;
  else if (vLang.startsWith(lang.slice(0, 2).toLowerCase())) score += 30;
  else if (vLang.startsWith('en')) score += 10; // English voice still beats nothing
  const prefIdx = PREFERRED_FEMALE.findIndex((p) => id.includes(p));
  if (prefIdx >= 0) score += 40 - prefIdx;
  if (/female|woman/.test(id)) score += 20;
  if (MALE_HINTS.test(id)) score -= 60;
  if (v.quality === Speech.VoiceQuality.Enhanced) score += 15;
  if (id.includes('local')) score += 8; // offline-capable on Android
  if (id.includes('network')) score -= 10;
  return score;
}

export async function listVoices(language: LanguageOption): Promise<VoiceOption[]> {
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    const lang = localeFor(language);
    return voices
      .filter((v) => /^(en|fil|tl)/i.test(v.language))
      .sort((a, b) => scoreVoice(b, lang) - scoreVoice(a, lang))
      .map((v) => ({
        identifier: v.identifier,
        name: v.name,
        language: v.language,
        enhanced: v.quality === Speech.VoiceQuality.Enhanced,
      }));
  } catch {
    return [];
  }
}

export async function pickBestVoice(language: LanguageOption): Promise<string | undefined> {
  const voices = await listVoices(language);
  return voices[0]?.identifier;
}

/** Cleans text so the synthesizer reads it naturally. */
function prepareForSpeech(text: string): string {
  return text
    .replace(/\b([A-Za-z])-(\1)/g, '$1… $2') // "W-what" → "W… what" (a natural stutter pause)
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/[*_~`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface SpeakOptions {
  mood: KurisuMood;
  language: LanguageOption;
  /** System TTS voice identifier. */
  voice?: string;
  /** Pitch / speed / expression tuning. */
  tune?: VoiceTune;
  /** Speak with the on-device Kokoro voice (this speaker id) instead of the system voice. */
  neuralSid?: number;
  onStart?: () => void;
  onDone?: () => void;
}

/** Final pitch/rate for a sentence: the user's tune, bent by her mood (scaled by expression). */
function prosodyFor(mood: KurisuMood, tune: VoiceTune = DEFAULT_TUNE) {
  const m = MOOD_PROSODY[mood] ?? MOOD_PROSODY.neutral;
  const bend = (moodFactor: number) => 1 + (moodFactor - 1) * tune.expression;
  return {
    pitch: clampTo(tune.pitch * bend(m.pitch), VOICE_TUNE_LIMITS.pitch),
    /** Multiplier on the engine's normal speed. */
    rate: clampTo(tune.rate * bend(m.rate), { min: 0.4, max: 2 }),
  };
}

function systemSpeechOptions(mood: KurisuMood, tune: VoiceTune | undefined) {
  const p = prosodyFor(mood, tune);
  return { pitch: p.pitch, rate: BASE_RATE * p.rate };
}

export function speak(text: string, options: SpeakOptions) {
  const stream = createSpeechStream(options);
  stream.push(text);
  stream.end();
}

/* ── Streaming speech: speak a reply sentence-by-sentence while the LLM is still writing it ── */

export interface SpeechStream {
  /** `mood` sets the delivery for this sentence (defaults to the stream's mood). */
  push(text: string, mood?: KurisuMood): void;
  /** No more text; onDone fires after the last sentence has been spoken. */
  end(): void;
  cancel(): void;
}

let currentSpeech: SpeechStream | null = null;

function systemStream(options: SpeakOptions): SpeechStream {
  const { mood, language, voice, tune, onStart, onDone } = options;
  let pending = 0;
  let ended = false;
  let started = false;
  let finished = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    onDone?.();
  };
  const settle = () => {
    pending = Math.max(0, pending - 1);
    if (ended && pending === 0) finish();
  };

  return {
    push(text, sentenceMood) {
      const cleaned = prepareForSpeech(text);
      if (finished || !cleaned) return;
      pending++;
      // expo-speech queues utterances natively, so sentences play back-to-back.
      Speech.speak(cleaned, {
        language: localeFor(language),
        voice,
        ...systemSpeechOptions(sentenceMood ?? mood, tune),
        onStart: () => {
          if (!started) {
            started = true;
            onStart?.();
          }
        },
        onDone: settle,
        onStopped: settle,
        onError: settle,
      });
    },
    end() {
      ended = true;
      if (pending === 0) finish();
    },
    cancel() {
      if (finished) return;
      Speech.stop().catch(() => {});
      finish();
    },
  };
}

/**
 * Neural (Kokoro) stream. If the engine can't start (model missing or failed to load), it hands
 * everything pushed so far to the system voice instead, so she is never silent.
 */
function neuralStream(options: SpeakOptions, sid: number): SpeechStream {
  const { mood, tune } = options;
  const pushed: { text: string; mood?: KurisuMood }[] = [];
  let ended = false;
  let fallback: SpeechStream | null = null;

  const inner: NeuralStream = neuralVoice.createStream({
    sid,
    pitch: (tune ?? DEFAULT_TUNE).pitch,
    onStart: options.onStart,
    onDone: options.onDone,
    onFail: (message) => {
      console.warn('[kurisu] neural voice unavailable, using the system voice:', message);
      fallback = systemStream(options);
      if (currentSpeech === wrapper) currentSpeech = fallback;
      pushed.forEach((p) => fallback!.push(p.text, p.mood));
      if (ended) fallback.end();
    },
  });

  const wrapper: SpeechStream = {
    push(text, sentenceMood) {
      if (fallback) return fallback.push(text, sentenceMood);
      const cleaned = prepareForSpeech(text);
      if (!cleaned) return;
      pushed.push({ text, mood: sentenceMood });
      inner.push(cleaned, prosodyFor(sentenceMood ?? mood, tune).rate);
    },
    end() {
      ended = true;
      if (fallback) fallback.end();
      else inner.end();
    },
    cancel() {
      if (fallback) fallback.cancel();
      else inner.cancel();
    },
  };
  return wrapper;
}

/** Opens a speech stream (neural voice when chosen and installed, else system); only one plays at a time. */
export function createSpeechStream(options: SpeakOptions): SpeechStream {
  currentSpeech?.cancel();
  const useNeural = options.neuralSid != null && neuralVoice.isInstalled();
  const stream = useNeural ? neuralStream(options, options.neuralSid!) : systemStream(options);
  currentSpeech = stream;
  return stream;
}

/**
 * Splits streaming LLM text into speakable pieces. Feed it the growing reply;
 * it returns only newly completed sentences, never re-emitting text.
 */
export class SentenceChunker {
  private spoken = 0;
  private spokenText = '';

  /** Returns newly completed text to speak (or '' if no sentence has finished yet). */
  feed(text: string): string {
    if (!text.startsWith(this.spokenText)) return ''; // text was rewritten (e.g. tag stripped) — wait for final
    const rest = text.slice(this.spoken);
    let cut = -1;
    // Sentence end: punctuation followed by whitespace, or a line break.
    const re = /[.!?…]+["'”’)\]]*\s+|\n+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(rest))) cut = m.index + m[0].length;
    // First piece: start talking at the first clause break so audio begins as early as possible.
    if (cut < 0 && this.spoken === 0) {
      const clause = rest.search(/[,;:—–]\s/);
      // Even a short interjection ("Hmph,") is worth sending alone: it synthesizes in a
      // fraction of a second and plays while the rest of the sentence is being generated.
      if (clause >= 3) cut = clause + 2;
    }
    // Very long clause without punctuation: break at a comma so she doesn't wait too long.
    if (cut < 0 && rest.length > 140) {
      const comma = rest.lastIndexOf(', ');
      if (comma > 40) cut = comma + 2;
    }
    if (cut <= 0) return '';
    const chunk = rest.slice(0, cut);
    this.spoken += cut;
    this.spokenText = text.slice(0, this.spoken);
    return chunk.trim();
  }

  /** Whatever of the final reply hasn't been spoken yet. */
  flush(finalText: string): string {
    if (this.spoken === 0) return finalText;
    if (finalText.startsWith(this.spokenText)) return finalText.slice(this.spoken).trim();
    // Final text diverged from what streamed (rare) — speak only what's clearly new.
    return finalText.length > this.spokenText.length ? finalText.slice(this.spokenText.length).trim() : '';
  }
}

export function stopSpeaking() {
  currentSpeech?.cancel();
  currentSpeech = null;
  Speech.stop().catch(() => {});
}

/* ──────────────────────────────  STT  ────────────────────────────── */

type SRModule = typeof import('expo-speech-recognition');
let sr: SRModule | null = null;
try {
  sr = require('expo-speech-recognition');
} catch {
  sr = null; // Expo Go: native module not bundled
}

export function sttSupported(): boolean {
  try {
    return !!sr && sr.ExpoSpeechRecognitionModule.isRecognitionAvailable();
  } catch {
    return false;
  }
}

export async function requestMicPermission(): Promise<boolean> {
  if (!sr) return false;
  try {
    const res = await sr.ExpoSpeechRecognitionModule.requestPermissionsAsync();
    return res.granted;
  } catch {
    return false;
  }
}

/**
 * On-device recognition only works if the locale's offline pack is *installed* —
 * merely supporting on-device mode isn't enough (the recognizer returns nothing).
 * Cached per locale; flipped off at runtime if the recognizer rejects it.
 */
const onDeviceCache = new Map<string, boolean>();

function sameLocale(a: string, b: string) {
  return a.toLowerCase().replace('_', '-') === b.toLowerCase().replace('_', '-');
}

/** Resolve whether offline recognition is usable for this language. Call before startListening. */
export async function prepareListening(language: LanguageOption): Promise<void> {
  const lang = localeFor(language);
  if (!sr || onDeviceCache.has(lang)) return;
  const mod = sr.ExpoSpeechRecognitionModule;
  let usable = false;
  try {
    if (mod.supportsOnDeviceRecognition()) {
      const { installedLocales } = await mod.getSupportedLocales({});
      usable = installedLocales.some((l) => sameLocale(l, lang));
    }
  } catch {
    usable = false;
  }
  onDeviceCache.set(lang, usable);
}

export type SttErrorCode = string;

/** Human-readable explanation for a recognizer error; null for errors that should stay silent. */
export function describeSttError(code: SttErrorCode | undefined, language: LanguageOption): string | null {
  switch (code) {
    case undefined:
    case 'aborted':
      return null;
    case 'no-speech':
    case 'speech-timeout':
    case 'nomatch':
      return 'I didn’t hear any speech. Hold the core while you talk, and make sure the mic isn’t muted.';
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone or speech permission is blocked. Enable it in system settings.';
    case 'audio-capture':
      return 'The microphone is busy or unavailable. Close other apps using it and try again.';
    case 'language-not-supported':
      return language === 'English'
        ? 'Speech recognition for English isn’t available on this device.'
        : 'This device can’t recognize Filipino speech. Try the English or Taglish setting.';
    case 'network':
      return 'Speech recognition needs a connection on this device (no offline language pack installed).';
    case 'ondevice-fallback':
      return 'The offline speech pack didn’t work, so I switched to standard recognition. Try again.';
    case 'busy':
      return 'The speech recognizer is busy. Wait a second and try again.';
    default:
      return `Speech recognition error (${code}). Try again.`;
  }
}

export interface ListenHandlers {
  onPartial: (text: string) => void;
  /** Fires once when the session ends. `error` is the recognizer error code, if any. */
  onFinal: (text: string, error?: SttErrorCode) => void;
  onVolume?: (level: number) => void; // 0..1
}

/**
 * Starts a listening session (call prepareListening first). Returns a cleanup that removes listeners.
 * onFinal always fires exactly once, with whatever was heard — even if no "final" result arrived.
 */
export function startListening(language: LanguageOption, handlers: ListenHandlers): () => void {
  if (!sr) {
    handlers.onFinal('', 'service-not-allowed');
    return () => {};
  }
  const mod = sr.ExpoSpeechRecognitionModule;
  const lang = localeFor(language);
  const onDevice = onDeviceCache.get(lang) ?? false;
  let finalText = '';
  let lastPartial = '';
  let errorCode: SttErrorCode | undefined;
  let done = false;
  let earlyTimer: ReturnType<typeof setTimeout> | null = null;

  // A session still running (e.g. continuous mode's auto-listen) must be shut down first. Its
  // trailing "end" / "aborted" events arrive after ours are attached, so anything before our own
  // "start" event belongs to the old session and is ignored.
  trackRecognizer(mod);
  const replacing = recognizerOpen;
  if (replacing) {
    try {
      mod.abort();
    } catch {}
  }
  let started = !replacing;
  // Safety net: if a device never emits "start", stop ignoring events after a moment.
  const startTimer = replacing
    ? setTimeout(() => {
        started = true;
      }, 2500)
    : null;

  const session = {
    /** User released: stop capture, and don't wait long for the recognizer's "final" pass. */
    requestStop() {
      try {
        mod.stop();
      } catch {}
      earlyTimer = setTimeout(() => {
        if (!done && lastPartial.trim()) finish();
      }, EARLY_FINAL_MS);
      // Never leave the call stuck in "listening" if the recognizer's "end" gets lost.
      setTimeout(() => {
        if (!done) finish();
      }, STOP_TIMEOUT_MS);
    },
  };
  activeSession = session;

  const finish = () => {
    if (done) return;
    done = true;
    if (earlyTimer) clearTimeout(earlyTimer);
    if (startTimer) clearTimeout(startTimer);
    if (activeSession === session) activeSession = null;
    subs.forEach((s) => s.remove());
    // Android sometimes ends without an isFinal result after stop(); keep the interim text.
    const heard = (finalText || lastPartial).trim();
    handlers.onFinal(heard, heard ? undefined : errorCode);
  };

  const subs = [
    mod.addListener('start', () => {
      started = true;
    }),
    mod.addListener('result', (e) => {
      if (!started) return;
      const t = e.results[0]?.transcript ?? '';
      if (e.isFinal) {
        finalText = `${finalText} ${t}`.trim();
        lastPartial = finalText;
      } else {
        lastPartial = `${finalText} ${t}`.trim();
      }
      handlers.onPartial(lastPartial);
    }),
    mod.addListener('volumechange', (e) => handlers.onVolume?.(Math.max(0, Math.min(1, (e.value + 2) / 12)))),
    mod.addListener('error', (e) => {
      // The replaced session reporting its own abort.
      if (!started && e.error === 'aborted') return;
      errorCode = e.error;
      // Offline pack was reported installed but the recognizer refused it — use the standard service next time.
      if (onDevice && (e.error === 'language-not-supported' || e.error === 'network')) {
        onDeviceCache.set(lang, false);
        errorCode = 'ondevice-fallback';
      }
    }),
    mod.addListener('end', () => {
      if (started) finish();
    }),
  ];

  const begin = () => {
    if (done) return;
    try {
      recognizerOpen = true;
      mod.start({
        lang,
        interimResults: true,
        continuous: false,
        maxAlternatives: 1,
        requiresOnDeviceRecognition: onDevice,
        addsPunctuation: true,
        contextualStrings: ['Kurisu', 'AnKurisu', 'Gradle', 'React Native', 'Expo'],
        volumeChangeEventOptions: { enabled: true, intervalMillis: 120 },
      });
    } catch {
      started = true;
      errorCode = 'audio-capture';
      finish();
    }
  };
  // Starting right after abort() hits a recognizer that is still tearing down ("busy").
  const beginTimer = replacing ? setTimeout(begin, REPLACE_DELAY_MS) : null;
  if (!replacing) begin();

  return () => {
    if (beginTimer) clearTimeout(beginTimer);
    done = true;
    if (earlyTimer) clearTimeout(earlyTimer);
    if (startTimer) clearTimeout(startTimer);
    if (activeSession === session) activeSession = null;
    subs.forEach((s) => s.remove());
  };
}

/**
 * Android can take ~0.5–1 s after stop() to deliver the "final" transcript, which almost always
 * matches the last interim one. If it hasn't arrived by then, answer from the interim text.
 */
const EARLY_FINAL_MS = 400;

/**
 * Whether the native recognizer is still running, tracked independently of any session's
 * listeners (a session's cleanup removes its listeners while the recognizer may still be live).
 */
let recognizerOpen = false;
let recognizerTracked = false;
function trackRecognizer(mod: NonNullable<typeof sr>['ExpoSpeechRecognitionModule']) {
  if (recognizerTracked) return;
  recognizerTracked = true;
  mod.addListener('start', () => {
    recognizerOpen = true;
  });
  mod.addListener('end', () => {
    recognizerOpen = false;
  });
}
const STOP_TIMEOUT_MS = 2000;
const REPLACE_DELAY_MS = 200;
let activeSession: { requestStop: () => void } | null = null;

/** True while a listening session is open (including one started by continuous mode). */
export function isListening() {
  return activeSession !== null;
}

/** Stop capturing and emit the final result (quickly). */
export function stopListening() {
  if (activeSession) {
    activeSession.requestStop();
    return;
  }
  try {
    sr?.ExpoSpeechRecognitionModule.stop();
  } catch {}
}

export function abortListening() {
  try {
    sr?.ExpoSpeechRecognitionModule.abort();
  } catch {}
}
