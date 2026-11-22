import * as Haptics from 'expo-haptics';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { KurisuMood } from '@/constants/sprites';
import * as brainApi from '@/services/llm';
import {
  ParsedReply,
  affinityDelta,
  buildHistory,
  buildSystemPrompt,
  fallbackReply,
  parseReply,
  polishReply,
} from '@/services/persona';
import { ActionResult, leavesApp, runAction } from '@/services/actions';
import { currentSnapshot, DeviceSnapshot, formatSnapshot, refreshSnapshot } from '@/services/deviceContext';
import { initNotifications } from '@/services/notifications';
import { wakeWord } from '@/services/wakeWord';
import { formatClock } from '@/services/when';
import { loadJSON, saveJSON } from '@/services/storage';
import { DEFAULT_TUNE, type VoiceTune } from '@/services/voice';

export type NoteCategory = 'About you' | 'Projects' | 'Reminders';

export interface LabNote {
  id: string;
  category: NoteCategory;
  timestamp: string;
  content: string;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'kurisu';
  text: string;
  mood?: KurisuMood;
  /** User turns: the text plus the [STATUS] line exactly as the brain saw it. */
  promptText?: string;
  /** Her ACTION line, exactly as written. */
  action?: string;
  /** What happened when it ran (shown as a HUD chip). */
  actionResult?: { ok: boolean; label: string };
}

export type LanguageOption = 'English' | 'Filipino' | 'Taglish';

export interface AppSettings {
  attitude: number; // 0 to 1
  language: LanguageOption;
  wakePhrase: boolean;
  pushToTalk: boolean;
  /** Voice call keeps listening after she answers, like a real conversation. */
  continuousMode: boolean;
  /** A short status briefing the first time the voice link opens each day. */
  dailyBriefing: boolean;
  moodHaptics: boolean;
  /** Let Gemini search Google before answering (current events, facts it's unsure of). */
  webKnowledge: boolean;
  /** expo-speech voice identifier; undefined = auto-pick best female voice. */
  voiceId?: string;
  /** Pitch / speed / expression of her voice. */
  voiceTune: VoiceTune;
}

export type VoicePackStatus = 'unsupported' | 'missing' | 'downloading' | 'extracting' | 'ready' | 'error';

export interface VoicePackState {
  status: VoicePackStatus;
  progress: number;
  error?: string;
}

/** checking = reading the saved key at startup; missing = no Gemini API key yet. */
export type BrainStatus = 'checking' | 'missing' | 'ready' | 'error';

export interface BrainState {
  status: BrainStatus;
  error?: string;
  tokensPerSecond: number;
  /** Prompt tokens Gemini read for the last reply. */
  contextUsed: number;
}

interface AppContextValue {
  hydrated: boolean;
  affinity: number;
  notes: LabNote[];
  messages: ChatMessage[];
  settings: AppSettings;
  brain: BrainState;
  isGenerating: boolean;
  deleteNote: (id: string) => void;
  forgetAllNotes: () => void;
  clearChat: () => void;
  addMessage: (sender: 'user' | 'kurisu', text: string, mood?: KurisuMood) => void;
  updateSettings: (patch: Partial<AppSettings>) => void;
  triggerMoodHaptic: () => void;
  /** Send a user message and get Kurisu's reply. onPartial streams her text as it generates. */
  ask: (text: string, onPartial?: (partial: ParsedReply) => void, options?: AskOptions) => Promise<AskResult>;
  /** Today's briefing, or null when it already ran today (or briefings are off). */
  runBriefing: (onPartial?: (partial: ParsedReply) => void) => Promise<AskResult | null>;
  /** True when today's briefing hasn't played yet (and briefings are on). */
  briefingDue: () => Promise<boolean>;
  stopGenerating: () => void;
  /** Checks the key with Gemini, then stores it. Throws a BrainError when it's rejected. */
  saveApiKey: (key: string) => Promise<void>;
  removeApiKey: () => Promise<void>;
  /** The "Hey Kurisu" wake word model (~18 MB). */
  wakeModel: VoicePackState;
  installWakeModel: () => Promise<void>;
  cancelWakeModelInstall: () => void;
  removeWakeModel: () => Promise<void>;
}

export interface AskOptions {
  /**
   * Don't run app-switching actions (open, call, maps...) yet: return them as `runDeferred` so the
   * voice call can finish speaking first.
   */
  deferExternal?: boolean;
  /** Internal prompt (e.g. the briefing): not shown in the log and doesn't move affinity. */
  hidden?: boolean;
}

export interface AskResult extends ParsedReply {
  id: string;
  actionResult?: ActionResult;
  runDeferred?: () => Promise<ActionResult>;
}

const BRIEFING_PROMPT =
  "(The user just opened the voice link for the first time today. Give a short spoken briefing in character: a greeting that fits the time of day, then only the useful parts of the status: today's calendar, pending reminders, low battery. At most 3 sentences. No ACTION line. This is the one time you may greet them.)";

/** Briefing without the brain: built from the same device status. */
function scriptedBriefing(s: DeviceSnapshot): ParsedReply {
  const h = s.now.getHours();
  const hello = h < 5 ? 'Still awake? Unbelievable.' : h < 12 ? 'Morning.' : h < 18 ? 'Afternoon.' : 'Evening.';
  const bits = [`${hello} It's ${formatClock(s.now)}.`];
  const next = s.events[0];
  if (next) {
    const count = s.events.length === 1 ? 'one event' : `${s.events.length} events`;
    bits.push(`You have ${count} left today, starting with ${next.title}.`);
  }
  const reminders = s.scheduled.filter((i) => i.kind === 'reminder').length;
  if (reminders) bits.push(`${reminders === 1 ? 'One reminder is' : `${reminders} reminders are`} pending.`);
  if (s.battery != null && s.battery < 25 && !s.charging) bits.push(`Battery's at ${s.battery} percent, so charge it.`);
  if (bits.length === 1) bits.push('Nothing on the schedule. Try to be productive anyway.');
  return { text: bits.join(' '), mood: 'confident' };
}

const GREETING: ChatMessage = {
  id: 'msg-hello',
  sender: 'kurisu',
  text: 'Link established. Don’t waste my time with small talk. What are we working on?',
  mood: 'confident',
};

const DEFAULT_SETTINGS: AppSettings = {
  attitude: 0.6,
  language: 'English',
  wakePhrase: false,
  pushToTalk: true,
  continuousMode: true,
  dailyBriefing: true,
  moodHaptics: true,
  webKnowledge: true,
  voiceTune: DEFAULT_TUNE,
};

const KEYS = {
  settings: 'ankurisu.settings.v1',
  notes: 'ankurisu.notes.v1',
  messages: 'ankurisu.messages.v1',
  affinity: 'ankurisu.affinity.v1',
  briefing: 'ankurisu.briefing.v1',
};

const MAX_STORED_MESSAGES = 200;

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function nowStamp() {
  const d = new Date();
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d
    .toTimeString()
    .slice(0, 5)}`;
}

/**
 * Wraps a 0..1 progress callback so it only fires when the whole percentage changes.
 * Download callbacks fire many times per second; each one would otherwise re-render every
 * screen that reads the context (including ones hidden lower in the stack).
 */
function stepped(fn: (progress: number, phase?: string) => void) {
  let last = '';
  return (progress: number, phase = '') => {
    const key = `${phase}|${Math.floor(progress * 100)}`;
    if (key === last) return;
    last = key;
    fn(progress, phase);
  };
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const [affinity, setAffinity] = useState(50);
  const [notes, setNotes] = useState<LabNote[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([GREETING]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [isGenerating, setIsGenerating] = useState(false);
  const [brain, setBrain] = useState<BrainState>({ status: 'checking', tokensPerSecond: 0, contextUsed: 0 });

  // Refs mirror state so async generation always sees the latest values.
  const stateRef = useRef({ affinity, notes, messages, settings, brain });
  stateRef.current = { affinity, notes, messages, settings, brain };
  const turnRef = useRef(0);

  /* ── Hydrate from disk ── */
  useEffect(() => {
    (async () => {
      const [s, n, m, a] = await Promise.all([
        loadJSON<AppSettings>(KEYS.settings),
        loadJSON<LabNote[]>(KEYS.notes),
        loadJSON<ChatMessage[]>(KEYS.messages),
        loadJSON<number>(KEYS.affinity),
      ]);
      if (s) {
        // Drop fields from removed features: the old brain picker and the neural voice packs.
        const {
          brainModel: _brainModel,
          voiceEngine: _voiceEngine,
          neuralPack: _neuralPack,
          neuralSid: _neuralSid,
          kittenSid: _kittenSid,
          ...saved
        } = s as AppSettings & Record<'brainModel' | 'voiceEngine' | 'neuralPack' | 'neuralSid' | 'kittenSid', unknown>;
        const merged = { ...DEFAULT_SETTINGS, ...saved };
        merged.voiceTune = { ...DEFAULT_TUNE, ...s.voiceTune };
        setSettings(merged);
      }
      if (n) setNotes(n);
      if (m && m.length) setMessages(m);
      if (typeof a === 'number') setAffinity(a);
      setHydrated(true);
    })();
  }, []);

  /* ── Persist ── */
  useEffect(() => {
    if (hydrated) saveJSON(KEYS.settings, settings);
  }, [hydrated, settings]);
  useEffect(() => {
    if (hydrated) saveJSON(KEYS.notes, notes);
  }, [hydrated, notes]);
  // A turn changes the log several times in quick succession (user line, reply, action result);
  // serialize the whole log once after it settles instead of on every change.
  useEffect(() => {
    if (!hydrated) return;
    const timer = setTimeout(() => saveJSON(KEYS.messages, messages.slice(-MAX_STORED_MESSAGES)), 300);
    return () => clearTimeout(timer);
  }, [hydrated, messages]);
  useEffect(() => {
    if (hydrated) saveJSON(KEYS.affinity, affinity);
  }, [hydrated, affinity]);

  /* ── Brain: Gemini is ready whenever an API key is saved ── */
  useEffect(() => {
    if (!hydrated) return;
    brainApi.removeLegacyDownloads();
    brainApi
      .getApiKey()
      .then((key) => setBrain((b) => ({ ...b, status: key ? 'ready' : 'missing', error: undefined })));
    initNotifications();
    refreshSnapshot().catch(() => {}); // warm the status cache before the first message
  }, [hydrated]);

  const saveApiKey = useCallback(async (key: string) => {
    await brainApi.verifyApiKey(key);
    await brainApi.setApiKey(key);
    setBrain((b) => ({ ...b, status: 'ready', error: undefined }));
  }, []);

  const removeApiKey = useCallback(async () => {
    await brainApi.setApiKey(null);
    // Falls back to the .env key when there is one.
    const fallback = await brainApi.getApiKey();
    setBrain((b) => ({ ...b, status: fallback ? 'ready' : 'missing', error: undefined }));
  }, []);

  /* ── Wake word model ── */
  const [wakeModel, setWakeModel] = useState<VoicePackState>(() => ({
    status: !wakeWord.isSupported() ? 'unsupported' : wakeWord.isInstalled() ? 'ready' : 'missing',
    progress: 0,
  }));

  const installWakeModel = useCallback(async () => {
    setWakeModel({ status: 'downloading', progress: 0 });
    try {
      const report = stepped((progress, phase) => setWakeModel({ status: phase as VoicePackStatus, progress }));
      await wakeWord.install((phase, progress) => report(progress, phase));
      setWakeModel({ status: 'ready', progress: 1 });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const cancelled = /cancel/i.test(msg);
      setWakeModel({ status: cancelled ? 'missing' : 'error', progress: 0, error: cancelled ? undefined : msg });
      throw e;
    }
  }, []);

  const cancelWakeModelInstall = useCallback(() => wakeWord.cancelInstall(), []);

  const removeWakeModel = useCallback(async () => {
    await wakeWord.remove();
    setWakeModel({ status: 'missing', progress: 0 });
  }, []);

  /* ── Messages / notes ── */
  const addMessage = useCallback((sender: 'user' | 'kurisu', text: string, mood?: KurisuMood) => {
    setMessages((prev) => [...prev, { id: makeId('msg'), sender, text, mood }]);
  }, []);

  const addNote = useCallback((category: NoteCategory, content: string) => {
    setNotes((prev) => {
      const dup = prev.some((n) => n.content.toLowerCase() === content.toLowerCase());
      if (dup) return prev;
      return [{ id: makeId('note'), category, content, timestamp: nowStamp() }, ...prev].slice(0, 100);
    });
  }, []);

  const deleteNote = useCallback((id: string) => setNotes((prev) => prev.filter((n) => n.id !== id)), []);
  const forgetAllNotes = useCallback(() => setNotes([]), []);
  const clearChat = useCallback(() => setMessages([GREETING]), []);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const triggerMoodHaptic = useCallback(() => {
    if (stateRef.current.settings.moodHaptics && Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
  }, []);

  /* ── The conversation pipeline ── */
  const ask = useCallback(
    async (text: string, onPartial?: (partial: ParsedReply) => void, options: AskOptions = {}): Promise<AskResult> => {
      const trimmed = text.trim();
      const { messages: history, settings: s, affinity: aff, notes: n, brain: b } = stateRef.current;
      // The status line is stored with the turn and replayed verbatim in later prompts, so the
      // history prefix stays identical (Gemini caches repeated prompt prefixes). It's read from a
      // background-refreshed cache, so it never delays the reply.
      const snapshot = currentSnapshot();
      const userMsg: ChatMessage = {
        id: makeId('msg'),
        sender: 'user',
        text: trimmed,
        promptText: `${trimmed}\n\n${formatSnapshot(snapshot)}`,
      };
      if (!options.hidden) {
        setMessages((prev) => [...prev, userMsg]);
        setAffinity((a) => Math.max(0, Math.min(100, a + affinityDelta(trimmed))));
      }

      let reply: ParsedReply;

      if (b.status !== 'ready') {
        // No API key yet: scripted lines that point the user to Settings.
        await new Promise((r) => setTimeout(r, 450));
        reply = fallbackReply(turnRef.current++);
      } else if (!snapshot.online) {
        await new Promise((r) => setTimeout(r, 300));
        reply = { text: "No signal. I can't think without a connection, so find some Wi-Fi.", mood: 'pouting' };
      } else {
        setIsGenerating(true);
        try {
          const result = await brainApi.generate({
            system: buildSystemPrompt(s, aff, n),
            turns: buildHistory([...history, userMsg]),
            webSearch: s.webKnowledge,
            onToken: (acc) => onPartial?.(parseReply(acc)),
          });
          if (__DEV__) {
            console.log(`[kurisu] tokens: ${result.promptTokens} in · ${result.outputTokens} out`);
            if (result.searches.length) console.log('[kurisu] searched Google:', result.searches.join(' | '));
          }
          reply = polishReply(parseReply(result.text));
          if (!reply.text) reply = { ...reply, text: '…Hmm. Say that again?' };
          setBrain((prev) => ({
            ...prev,
            error: undefined,
            tokensPerSecond: result.tokensPerSecond || prev.tokensPerSecond,
            contextUsed: result.promptTokens || prev.contextUsed,
          }));
        } catch (e) {
          const kind = e instanceof brainApi.BrainError ? e.kind : 'server';
          const msg = e instanceof Error ? e.message : String(e);
          reply =
            kind === 'auth'
              ? { text: 'My link is rejecting the API key. Check it in Settings.', mood: 'serious' }
              : kind === 'quota'
                ? { text: "I've hit my usage limit for now. Give it a little while.", mood: 'pouting' }
                : kind === 'network'
                  ? { text: 'The connection dropped mid-thought. Say that again?', mood: 'shocked' }
                  : kind === 'blocked'
                    ? { text: "Hmph. I'm not answering that one.", mood: 'serious' }
                    : { text: 'Tch — something went wrong on my end. Try again in a second.', mood: 'shocked' };
          setBrain((prev) => ({ ...prev, error: msg, status: kind === 'auth' ? 'error' : prev.status }));
          console.warn('[kurisu] generation failed', e);
        } finally {
          setIsGenerating(false);
        }
      }

      const id = makeId('msg');
      const action = reply.action;
      const setResult = (r: ActionResult) =>
        setMessages((prev) =>
          prev.map((m) => (m.id === id ? { ...m, actionResult: { ok: r.ok, label: r.label } } : m))
        );
      setMessages((prev) => [
        ...prev,
        { id, sender: 'kurisu', text: reply.text, mood: reply.mood, action: action?.raw },
      ]);
      if (reply.note) addNote(reply.note.category, reply.note.content);

      if (!action) return { ...reply, id };
      if (options.deferExternal && leavesApp(action.kind)) {
        return {
          ...reply,
          id,
          runDeferred: async () => {
            const r = await runAction(action);
            setResult(r);
            return r;
          },
        };
      }
      const actionResult = await runAction(action);
      refreshSnapshot().catch(() => {}); // pending timers / reminders changed
      setResult(actionResult);
      return { ...reply, id, actionResult };
    },
    [addNote]
  );

  const briefingDue = useCallback(async () => {
    if (!stateRef.current.settings.dailyBriefing) return false;
    return (await loadJSON<string>(KEYS.briefing)) !== new Date().toDateString();
  }, []);

  const runBriefing = useCallback(
    async (onPartial?: (partial: ParsedReply) => void): Promise<AskResult | null> => {
      if (!(await briefingDue())) return null;
      saveJSON(KEYS.briefing, new Date().toDateString());
      if (stateRef.current.brain.status === 'ready' && currentSnapshot().online) {
        return ask(BRIEFING_PROMPT, onPartial, { hidden: true });
      }
      const reply = scriptedBriefing(await refreshSnapshot().catch(() => currentSnapshot()));
      const id = makeId('msg');
      setMessages((prev) => [...prev, { id, sender: 'kurisu', text: reply.text, mood: reply.mood }]);
      return { ...reply, id };
    },
    [ask, briefingDue]
  );

  const stopGenerating = useCallback(() => {
    brainApi.stop();
  }, []);

  const value = useMemo<AppContextValue>(
    () => ({
      hydrated,
      affinity,
      notes,
      messages,
      settings,
      brain,
      isGenerating,
      deleteNote,
      forgetAllNotes,
      clearChat,
      addMessage,
      updateSettings,
      triggerMoodHaptic,
      ask,
      runBriefing,
      briefingDue,
      stopGenerating,
      saveApiKey,
      removeApiKey,
      wakeModel,
      installWakeModel,
      cancelWakeModelInstall,
      removeWakeModel,
    }),
    [
      hydrated,
      affinity,
      notes,
      messages,
      settings,
      brain,
      isGenerating,
      deleteNote,
      forgetAllNotes,
      clearChat,
      addMessage,
      updateSettings,
      triggerMoodHaptic,
      ask,
      runBriefing,
      briefingDue,
      stopGenerating,
      saveApiKey,
      removeApiKey,
      wakeModel,
      installWakeModel,
      cancelWakeModelInstall,
      removeWakeModel,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppState() {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useAppState must be used inside AppProvider');
  }
  return ctx;
}
