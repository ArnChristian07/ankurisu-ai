import { useBatteryLevel } from 'expo-battery';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useIsFocused } from 'expo-router';
import { FlaskConical, Keyboard, Mic, PhoneOff, Settings } from 'lucide-react-native';
import React, { memo, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextProps, useWindowDimensions, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GridBackground } from '@/components/GridBackground';
import { createTextSource, TextSource, TypewriterText } from '@/components/TypewriterText';
import { GlitchSprite } from '@/components/hud/GlitchSprite';
import { ThinkingText } from '@/components/ThinkingText';
import { HoloCore } from '@/components/hud/HoloCore';
import { HudFrame } from '@/components/hud/HudFrame';
import { HudIconButton } from '@/components/hud/HudIconButton';
import { HudRing } from '@/components/hud/HudRing';
import { Scanlines } from '@/components/hud/Scanlines';
import { WaveformVisualizer } from '@/components/WaveformVisualizer';
import { KurisuMood, MOOD_COLORS, MOOD_LIST, SPRITE_MAP } from '@/constants/sprites';
import { HUD, MONO } from '@/constants/theme';
import { AskResult, neuralSidFor, useAppState } from '@/context/AppContext';
import type { ParsedReply } from '@/services/persona';
import { neuralVoice } from '@/services/neuralVoice';
import { wakeWord } from '@/services/wakeWord';
import {
  abortListening,
  createSpeechStream,
  describeSttError,
  pickBestVoice,
  prepareListening,
  requestMicPermission,
  SentenceChunker,
  SpeechStream,
  startListening,
  stopListening,
  isListening,
  stopSpeaking,
  sttSupported,
} from '@/services/voice';

/** 5 lines of the 27px-leading transcript text. */
const REPLY_MAX_HEIGHT = 27 * 5;

type CallStatus ='speaking' | 'listening' | 'thinking' | 'idle';

const STATUS_COLOR: Record<CallStatus, string> = {
  speaking: HUD.holo,
  listening: HUD.ok,
  thinking: HUD.warn,
  idle: HUD.textDim,
};

const RING_SPEED: Record<CallStatus, number> = {
  speaking: 1,
  listening: 1.4,
  thinking: 3,
  idle: 0.4,
};

const Telemetry = memo(function Telemetry({ label, value, color = HUD.textMuted, align = 'left' }: {
  label: string;
  value: string;
  color?: string;
  align?: 'left' | 'right';
}) {
  const right = align === 'right';
  return (
    <View
      style={{
        borderLeftWidth: right ? 0 : 1,
        borderRightWidth: right ? 1 : 0,
        borderColor: HUD.holoDeep,
        alignItems: right ? 'flex-end' : 'flex-start',
      }}
      className="px-2 py-0.5"
    >
      <Text style={[MONO, { color: HUD.textDim }]} className="text-[8.5px] tracking-[1.5px]">
        {label}
      </Text>
      <Text style={[MONO, { color }]} className="text-[11px]">
        {value}
      </Text>
    </View>
  );
});

/** Renders a TextSource; only this text re-renders when the source changes. */
function SourceText({ source, fallback, ...props }: { source: TextSource; fallback: string } & TextProps) {
  const value = useSyncExternalStore(source.subscribe, source.get);
  return <Text {...props}>{value || fallback}</Text>;
}

/** Owns the 1-second tick so it doesn't re-render the sprite, core and scanlines every second. */
function LinkTimer({ online }: { online: boolean }) {
  const [secondsElapsed, setSecondsElapsed] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setSecondsElapsed((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, []);
  const mins = Math.floor(secondsElapsed / 60).toString().padStart(2, '0');
  const secs = (secondsElapsed % 60).toString().padStart(2, '0');
  return (
    <Text style={[MONO, { color: HUD.textMuted }]} className="text-[10.5px] tracking-[1px]">
      LINK {mins}:{secs} · {online ? 'ON-DEVICE' : 'NO BRAIN'}
    </Text>
  );
}

export default function VoiceCallScreen() {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const {
    affinity,
    messages,
    settings,
    brain,
    ask,
    runBriefing,
    briefingDue,
    stopGenerating,
    triggerMoodHaptic,
    wakeModel,
  } = useAppState();
  const batteryLevel = useBatteryLevel();
  // Only needed to seed the initial state, so look them up once instead of on every render.
  const [initial] = useState(() => ({
    user: messages.findLast((m) => m.sender === 'user'),
    kurisu: messages.findLast((m) => m.sender === 'kurisu'),
  }));

  const [mood, setMood] = useState<KurisuMood>(initial.kurisu?.mood ?? 'happy');
  const [status, setStatus] = useState<CallStatus>('idle');
  // What the recognizer hears goes to a text source, not state: partial results (several per
  // second) re-render only the transcript text instead of the whole call screen.
  const [userSource] = useState(() => createTextSource(initial.user?.text ?? ''));
  // Her streamed line goes to a text source, not state: tokens re-render only the transcript text.
  const [kurisuSource] = useState(() => createTextSource(initial.kurisu?.text ?? ''));
  const [replyStarted, setReplyStarted] = useState(true);
  // Where the transcript starts typing when it (re)mounts: the old line shows whole, a new reply types from 0.
  const [typeFrom, setTypeFrom] = useState(Number.MAX_SAFE_INTEGER);
  const [hint, setHint] = useState<string | null>(null);
  const [firstTokenMs, setFirstTokenMs] = useState<number | null>(null);
  const [autoVoice, setAutoVoice] = useState<string | undefined>(undefined);
  const micReady = sttSupported();
  // Chat, settings and lab notes push on top of this screen without unmounting it. Its looping
  // animations (sprite, core, scanlines...) would keep running on the UI thread underneath and
  // make those screens and their transitions stutter, so everything pauses while it's covered.
  const focused = useIsFocused();

  const floatY = useSharedValue(0);
  const spriteScale = useSharedValue(1);
  const micPulse = useSharedValue(1);
  const recBlink = useSharedValue(1);

  useEffect(() => {
    if (!focused) return;
    floatY.value = withRepeat(
      withSequence(
        withTiming(-5, { duration: 2200, easing: Easing.inOut(Easing.ease) }),
        withTiming(3, { duration: 2200, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );
    recBlink.value = withRepeat(
      withSequence(withTiming(0.25, { duration: 700 }), withTiming(1, { duration: 700 })),
      -1,
      true
    );
    return () => {
      cancelAnimation(floatY);
      cancelAnimation(recBlink);
    };
  }, [focused, floatY, recBlink]);

  useEffect(() => {
    if (focused && (status === 'listening' || status === 'speaking')) {
      micPulse.value = withRepeat(
        withSequence(
          withTiming(1.12, { duration: 900, easing: Easing.inOut(Easing.ease) }),
          withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        true
      );
    } else {
      micPulse.value = withTiming(1, { duration: 250 });
    }
  }, [focused, status, micPulse]);

  // Pick her voice: the user's choice, else the best young female voice on the device.
  useEffect(() => {
    if (settings.voiceId) return;
    pickBestVoice(settings.language).then(setAutoVoice);
  }, [settings.language, settings.voiceId]);
  const voiceId = settings.voiceId ?? autoVoice;

  // Stop everything when the call screen goes away.
  const cleanupListenRef = useRef<() => void>(() => {});
  useEffect(
    () => () => {
      cleanupListenRef.current();
      abortListening();
      stopSpeaking();
    },
    []
  );

  // Tracks the current mood synchronously for streaming callbacks (always updated via changeMood).
  const moodRef = useRef(mood);
  // Transcript reply scroll: follows the typing unless the user has scrolled up to reread.
  const replyScrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const replyFollowRef = useRef(true);
  const changeMood = (next: KurisuMood) => {
    if (moodRef.current === next) return;
    moodRef.current = next;
    setMood(next);
    spriteScale.value = withSequence(withTiming(0.97, { duration: 90 }), withTiming(1, { duration: 220 }));
    triggerMoodHaptic();
  };

  const handleCycleMood = () => {
    const nextIdx = (MOOD_LIST.indexOf(mood) + 1) % MOOD_LIST.length;
    changeMood(MOOD_LIST[nextIdx]);
  };

  /* ── Conversation loop: STT → LLM → TTS ── */
  const busyRef = useRef(false);
  // Incremented on barge-in so a reply that's still generating knows it's been superseded.
  const turnRef = useRef(0);

  // Do the slow setup (permission + offline-locale check) when the call opens,
  // so pressing the core starts the mic immediately and no words are lost.
  const micGrantedRef = useRef(false);
  const [micGranted, setMicGranted] = useState(false);
  useEffect(() => {
    if (!micReady) return;
    requestMicPermission().then((ok) => {
      micGrantedRef.current = ok;
      setMicGranted(ok);
    });
    prepareListening(settings.language);
  }, [micReady, settings.language]);

  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    []
  );
  // The current listening session was opened by continuous mode, not by the user pressing the core.
  const autoListenRef = useRef(false);
  // The user has started talking at least once (so the briefing must not talk over them).
  const userActedRef = useRef(false);
  // Continuous mode re-opens the mic from inside playReply; beginListening is declared below it.
  const relistenRef = useRef<() => void>(() => {});
  const wakeHandlerRef = useRef<() => void>(() => {});
  // Stops the wake-word listener (a no-op while it isn't running).
  const wakeStopRef = useRef<() => Promise<void>>(async () => {});

  /**
   * Streams a reply into the transcript and her voice. Once she has finished speaking, runs any
   * app-switching action she asked for, or (continuous mode) opens the mic again.
   */
  const playReply = async (produce: (onPartial: (partial: ParsedReply) => void) => Promise<AskResult | null>) => {
    busyRef.current = true;
    replyFollowRef.current = true;
    kurisuSource.set('');
    setTypeFrom(0);
    setReplyStarted(false);
    setStatus('thinking');
    const t0 = Date.now();
    let gotFirst = false;
    let reply: AskResult | null = null;

    const turn = ++turnRef.current;
    const interrupted = () => turnRef.current !== turn || !mountedRef.current;

    const afterSpeech = async () => {
      if (interrupted() || !reply) return;
      if (reply.runDeferred) {
        const run = reply.runDeferred;
        reply = { ...reply, runDeferred: undefined }; // onDone can fire twice on engine fallback
        const result = await run();
        if (!result.ok && result.error) setHint(result.error);
        return; // she just switched to another app — don't open the mic behind the user's back
      }
      if (settings.continuousMode && micReady) {
        setTimeout(() => {
          if (interrupted() || busyRef.current) return;
          relistenRef.current();
        }, 350); // let the speaker's tail fade so the mic doesn't hear her
      }
    };

    // Speak sentence-by-sentence while the LLM is still writing, instead of waiting for the whole reply.
    // The stream opens right away (not at the first sentence) so the voice engine and audio
    // player spin up while the LLM is still thinking; each sentence carries its own mood.
    const chunker = new SentenceChunker();
    const stream: SpeechStream = createSpeechStream({
      mood: moodRef.current,
      language: settings.language,
      voice: voiceId,
      tune: settings.voiceTune,
      neuralSid: neuralSidFor(settings),
      // Switch to "speaking" when audio actually starts, not when text arrives.
      onStart: () => setStatus((s) => (s === 'thinking' ? 'speaking' : s)),
      onDone: () => {
        setStatus((s) => (s === 'speaking' || s === 'thinking' ? 'idle' : s));
        afterSpeech();
      },
    });

    try {
      reply = await produce((partial) => {
        if (interrupted()) return;
        if (!gotFirst && partial.text) {
          gotFirst = true;
          setFirstTokenMs(Date.now() - t0);
          setReplyStarted(true);
          changeMood(partial.mood);
        }
        kurisuSource.set(partial.text);
        const sentence = chunker.feed(partial.text);
        if (sentence) stream.push(sentence, partial.mood);
      });
      if (interrupted() || !reply) return; // user barged in — don't speak a stale reply
      changeMood(reply.mood);
      kurisuSource.set(reply.text);
      setReplyStarted(true);
      const rest = chunker.flush(reply.text);
      if (rest) stream.push(rest, reply.mood);
      // An action that failed (bad time, permission denied...) is admitted out loud.
      const failure = reply.actionResult && !reply.actionResult.ok ? reply.actionResult.error : undefined;
      if (failure) {
        stream.push(failure, 'serious');
        setHint(failure);
      } else if (reply.actionResult) {
        setHint(`✓ ${reply.actionResult.label}`);
      }
      stream.end();
    } finally {
      if (!interrupted()) busyRef.current = false;
    }
  };

  const respondTo = async (text: string, error?: string) => {
    const said = text.trim();
    const auto = autoListenRef.current;
    autoListenRef.current = false;
    if (!said) {
      setStatus('idle');
      // Silence after her reply in continuous mode just means the conversation paused.
      if (auto) return;
      // Aborted (accidental tap) stays silent; real errors explain themselves.
      const message = error ? describeSttError(error, settings.language) : null;
      if (message) setHint(message);
      else if (!error) setHint('I couldn’t make out any words. Hold the core, speak, then release.');
      return;
    }
    userSource.set(said);
    await playReply((onPartial) => ask(said, onPartial, { deferExternal: true }));
  };

  // Daily briefing: the first time the link opens each day, she reports in (once the saved key is read).
  const briefingCheckedRef = useRef(false);
  useEffect(() => {
    if (briefingCheckedRef.current || brain.status === 'checking') return;
    briefingCheckedRef.current = true;
    briefingDue().then((due) => {
      if (!due || !mountedRef.current || userActedRef.current || busyRef.current) return;
      userSource.set('');
      playReply((onPartial) => runBriefing(onPartial));
    });
    // playReply reads the latest settings through closures; this only needs to run once per call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brain.status]);

  /** `auto`: opened by continuous mode. `fromPress`: the user is holding the core (push-to-talk). */
  const beginListening = async (auto = false, fromPress = false) => {
    autoListenRef.current = auto;
    if (!auto) userActedRef.current = true;
    // Barge-in: interrupt her mid-reply (stop generation and speech) and listen.
    if (busyRef.current) {
      turnRef.current++;
      busyRef.current = false;
      stopGenerating();
    }
    stopSpeaking();
    if (!auto) setHint(null); // keep the "✓ TIMER…" confirmation visible while she listens again
    if (!micReady) {
      setHint('Voice input needs a development build. Tap the keyboard to type instead.');
      return;
    }
    if (!micGrantedRef.current) {
      // Only hits the bridge on the first press (or if permission was denied).
      micGrantedRef.current = await requestMicPermission();
      if (!micGrantedRef.current) {
        setHint('Microphone permission denied. Enable it in system settings.');
        return;
      }
      await prepareListening(settings.language);
      // Released while we were setting up — nothing was recorded.
      if (settings.pushToTalk && !holdingRef.current) {
        setHint('Mic is ready now. Hold the core while you speak.');
        return;
      }
    }
    setStatus('listening');
    userSource.set('');
    triggerMoodHaptic();
    // The wake-word listener holds the mic while idle; free it for the speech recognizer.
    await wakeStopRef.current();
    // Push-to-talk released while the mic was being freed: don't open it after the fact.
    if (fromPress && settings.pushToTalk && !holdingRef.current) {
      setStatus((s) => (s === 'listening' ? 'idle' : s));
      return;
    }
    cleanupListenRef.current();
    cleanupListenRef.current = startListening(settings.language, {
      onPartial: userSource.set,
      onFinal: (text, error) => {
        respondTo(text, error);
      },
    });
  };

  // Push-to-talk: hold the core to listen, release to send.
  const MIN_HOLD_MS = 250;
  const holdStartRef = useRef(0);
  const holdingRef = useRef(false);
  // This hold took over a session continuous mode had already opened.
  const takenOverRef = useRef(false);

  const handleMicPressIn = () => {
    if (!settings.pushToTalk) return;
    holdStartRef.current = Date.now();
    holdingRef.current = true;
    // Continuous mode already has the mic open: keep that session and let the release send it,
    // instead of starting a second recognizer on top of it.
    if (autoListenRef.current && isListening()) {
      autoListenRef.current = false;
      userActedRef.current = true;
      takenOverRef.current = true;
      return;
    }
    takenOverRef.current = false;
    beginListening(false, true);
  };

  const handleMicPressOut = () => {
    if (!settings.pushToTalk) return;
    holdingRef.current = false;
    // A quick tap on a session she opened herself means "send", not "cancel".
    if (Date.now() - holdStartRef.current < MIN_HOLD_MS && !takenOverRef.current) {
      // Too short to be speech — treat as an accidental tap and cancel.
      abortListening();
      setStatus((s) => (s === 'listening' ? 'idle' : s));
      return;
    }
    stopListening(); // emits the final transcript → respondTo
  };

  // Tap-to-talk (push-to-talk off): tap to start; the recognizer stops on silence, or tap again to send early.
  const handleMicPress = () => {
    if (settings.pushToTalk) return;
    if (status === 'listening') stopListening();
    else beginListening();
  };

  useEffect(() => {
    relistenRef.current = () => beginListening(true);
    wakeHandlerRef.current = () => beginListening();
  });

  /* ── "Hey Kurisu": listen for the wake word while the link is idle and on screen ── */
  const wakeArmed =
    settings.wakePhrase && wakeModel.status === 'ready' && micGranted && focused && status === 'idle';
  useEffect(() => {
    if (!wakeArmed) return;
    let cancelled = false;
    // Idle flickers between turns (continuous mode re-opens the mic 350 ms after she stops),
    // so only grab the mic once the link has really settled.
    const timer = setTimeout(() => {
      wakeWord
        .start(
          () => wakeHandlerRef.current(),
          (message) => console.warn('[kurisu] wake word error', message)
        )
        .then((stop) => {
          if (cancelled) stop();
          else wakeStopRef.current = stop;
        })
        .catch((e) => console.warn('[kurisu] wake word failed to start', e));
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      const stop = wakeStopRef.current;
      wakeStopRef.current = async () => {};
      stop();
    };
  }, [wakeArmed]);
  // Free the recognizer's memory when the call ends.
  useEffect(
    () => () => {
      wakeWord.unload();
    },
    []
  );
  // Load the neural voice while the call opens so her first line isn't delayed; free it after.
  // (Re-runs on focus: Settings frees the model when it closes.)
  useEffect(() => {
    if (settings.neuralVoice && focused) neuralVoice.preload();
  }, [settings.neuralVoice, focused]);
  useEffect(
    () => () => {
      neuralVoice.unload();
    },
    []
  );

  const endCall = () => {
    cleanupListenRef.current();
    abortListening();
    stopSpeaking();
    router.replace('/');
  };

  const spriteStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: floatY.value }, { scale: spriteScale.value }],
  }));
  const micRingStyle = useAnimatedStyle(() => ({ transform: [{ scale: micPulse.value }] }));
  const recStyle = useAnimatedStyle(() => ({ opacity: recBlink.value }));

  const moodColor = MOOD_COLORS[mood];
  const transcriptPhase =
    status === 'listening' ? 'listening' : status === 'thinking' && !replyStarted ? 'processing' : 'reply';
  const statusColor = STATUS_COLOR[status];
  // Thinking sprite until the first token arrives, then her actual mood.
  const spriteMood: KurisuMood = transcriptPhase === 'processing' ? 'curious' : mood;

  const brainOnline = brain.status === 'ready';
  const latency = firstTokenMs != null ? `${firstTokenMs}ms` : '—';
  const tokRate = brain.tokensPerSecond ? brain.tokensPerSecond.toFixed(1) : '—';
  const ctxLabel = brain.contextUsed ? `${(brain.contextUsed / 1000).toFixed(1)}k` : '—';
  const coreLabel =
    brain.status === 'ready'
      ? 'ON-DEVICE'
      : brain.status === 'checking'
        ? 'LINKING'
        : brain.status === 'unsupported'
          ? 'DEV BUILD'
          : 'NO BRAIN';
  const coreSize = Math.min(screenWidth * 1.08, 460);

  return (
    <View className="flex-1" style={{ backgroundColor: HUD.bg }}>
      <GridBackground glowY="30%" />

      {/* Holo core behind her — tinted by mood, spins faster while thinking */}
      <View
        pointerEvents="none"
        style={{ position: 'absolute', top: screenHeight * 0.1, left: 0, right: 0, alignItems: 'center' }}
      >
        <HoloCore size={coreSize} color={moodColor} speed={focused ? RING_SPEED[status] : 0} opacity={0.32} />
      </View>

      {/* Sprite */}
      <View style={StyleSheet.absoluteFill} className="items-center overflow-hidden" pointerEvents="none">
        <Animated.View style={[{ position: 'absolute', top: screenHeight * 0.125 }, spriteStyle]}>
          <GlitchSprite
            source={SPRITE_MAP[spriteMood]}
            seed={MOOD_LIST.indexOf(spriteMood) + 1}
            width={screenWidth * 1.15}
            height={screenHeight * 0.94}
            paused={!focused}
          />
        </Animated.View>

        <LinearGradient
          colors={['transparent', 'rgba(4,7,13,0.55)', 'rgba(4,7,13,0.93)', HUD.bg, HUD.bg]}
          locations={[0, 0.3, 0.56, 0.7, 1]}
          style={{ position: 'absolute', left: 0, right: 0, top: screenHeight * 0.46, bottom: 0 }}
        />
      </View>

      <Scanlines sweep={focused} />

      <SafeAreaView className="flex-1 justify-between">
        {/* Top bar */}
        <View className="px-5 pt-2">
          <View className="flex-row items-center justify-between">
            <HudIconButton onPress={() => router.push('/lab-notes')} accessibilityLabel="Lab notes">
              <FlaskConical size={19} color={HUD.text} strokeWidth={1.6} />
            </HudIconButton>

            <View className="items-center">
              <Text style={[MONO, { color: HUD.crimson }]} className="text-[9.5px] tracking-[4px]">
                VOICE LINK
              </Text>
              <Text className="text-[18px] font-bold tracking-[0.5px]" style={{ color: HUD.text }}>
                AnKurisu
              </Text>
              <View className="mt-0.5 flex-row items-center gap-1.5">
                <Animated.View
                  style={[recStyle, { backgroundColor: HUD.crimson }]}
                  className="h-[6px] w-[6px] rounded-full"
                />
                <LinkTimer online={brainOnline} />
              </View>
            </View>

            <HudIconButton onPress={() => router.push('/settings')} accessibilityLabel="Settings">
              <Settings size={19} color={HUD.text} strokeWidth={1.6} />
            </HudIconButton>
          </View>

          {/* Side telemetry */}
          <Animated.View entering={FadeIn.delay(300).duration(500)} className="mt-5 flex-row justify-between">
            <View className="gap-2.5">
              <Telemetry label="1ST TOKEN" value={latency} />
              <Telemetry label="TOK/S" value={tokRate} />
              <Telemetry label="CTX" value={ctxLabel} />
            </View>
            <View className="gap-2.5">
              <Telemetry
                label="CORE"
                value={coreLabel}
                color={brainOnline ? HUD.nixie : HUD.warn}
                align="right"
              />
              <Telemetry label="AFFINITY" value={`${affinity}/100`} align="right" />
              <Telemetry
                label="BATT"
                value={batteryLevel >= 0 ? `${Math.round(batteryLevel * 100)}%` : '—'}
                color={batteryLevel >= 0 && batteryLevel < 0.2 ? HUD.warn : HUD.ok}
                align="right"
              />
            </View>
          </Animated.View>
        </View>

        {/* Bottom console */}
        <View className="px-5 pb-4">
          <View className="mb-4 flex-row items-center justify-between">
            <Pressable onPress={handleCycleMood} className="active:opacity-75">
              <HudFrame corner={6} color={moodColor} className="flex-row items-center gap-2 px-3 py-1.5">
                <View style={{ backgroundColor: moodColor }} className="h-[6px] w-[6px]" />
                <Text style={[MONO, { color: HUD.textDim }]} className="text-[10px] tracking-[1.5px]">
                  MOOD
                </Text>
                <Text style={[MONO, { color: HUD.text }]} className="text-[10.5px] tracking-[1.5px]">
                  {mood.toUpperCase()}
                </Text>
              </HudFrame>
            </Pressable>

            <HudFrame corner={6} color={statusColor} className="flex-row items-center gap-2 px-3 py-1.5">
              <View style={{ backgroundColor: statusColor }} className="h-[6px] w-[6px] rounded-full" />
              <Text style={[MONO, { color: statusColor }]} className="text-[10.5px] tracking-[2px]">
                {status.toUpperCase()}
              </Text>
            </HudFrame>
          </View>

          <HudFrame label="TRANSCRIPT" meta="KURISU-01" className="mb-4 px-4 pb-4 pt-5">
            <Text style={[MONO, { color: HUD.textDim }]} numberOfLines={2} className="mb-1.5 text-[11px]">
              <Text style={{ color: HUD.holoDim }}>&gt; YOU </Text>
              <SourceText source={userSource} fallback={status === 'listening' ? '…' : '—'} />
            </Text>
            {/* Keyed by phase, not status, so thinking → speaking doesn't restart the typing. */}
            <Animated.View key={transcriptPhase} entering={FadeInDown.duration(260)}>
              {transcriptPhase === 'reply' ? (
                // Long replies scroll inside the box (5 lines tall) instead of being cut off.
                <ScrollView
                  ref={replyScrollRef}
                  style={{ maxHeight: REPLY_MAX_HEIGHT }}
                  nestedScrollEnabled
                  showsVerticalScrollIndicator
                  indicatorStyle="white"
                  scrollEventThrottle={64}
                  onScrollBeginDrag={() => (replyFollowRef.current = false)}
                  onScroll={(e) => {
                    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
                    // Back at the bottom → follow the typing again.
                    if (contentOffset.y + layoutMeasurement.height >= contentSize.height - 8) {
                      replyFollowRef.current = true;
                    }
                  }}
                  onContentSizeChange={() => {
                    if (replyFollowRef.current) replyScrollRef.current?.scrollToEnd({ animated: false });
                  }}
                >
                  <TypewriterText
                    source={kurisuSource}
                    streaming={status === 'thinking'}
                    startAt={typeFrom}
                    onDone={() => {
                      if (status !== 'thinking') setTypeFrom(Number.MAX_SAFE_INTEGER);
                    }}
                    cursorColor={moodColor}
                    className="text-[19px] font-semibold leading-[27px]"
                    style={{ color: HUD.text }}
                  />
                </ScrollView>
              ) : (
                transcriptPhase === 'listening' ? (
                  // Your words, live and large while you speak; the tail stays visible on long sentences.
                  <SourceText
                    source={userSource}
                    fallback="Listening…"
                    numberOfLines={4}
                    ellipsizeMode="head"
                    className="text-[19px] font-semibold leading-[27px]"
                    style={{ color: HUD.ok }}
                  />
                ) : (
                  <ThinkingText
                    numberOfLines={5}
                    className="text-[19px] font-semibold leading-[27px]"
                    style={{ color: HUD.textMuted }}
                  />
                )
              )}
            </Animated.View>
            {hint && (
              <Text
                style={[MONO, { color: hint.startsWith('✓') ? HUD.ok : HUD.warn }]}
                className="mt-2 text-[10.5px]"
              >
                {hint}
              </Text>
            )}
          </HudFrame>

          <WaveformVisualizer
            active={focused && (status === 'speaking' || status === 'listening')}
            color={status === 'listening' ? HUD.ok : HUD.holo}
          />

          <View className="mt-5 flex-row items-center justify-center gap-9">
            <Pressable
              onPress={() => router.push('/chat')}
              accessibilityLabel="Open text chat"
              className="h-[56px] w-[56px] items-center justify-center rounded-full active:scale-95"
              style={{ borderWidth: 1, borderColor: HUD.line, backgroundColor: HUD.panelSolid }}
            >
              <Keyboard size={21} color={HUD.text} strokeWidth={1.6} />
            </Pressable>

            <View className="h-[100px] w-[100px] items-center justify-center">
              <Animated.View
                style={[micRingStyle, { backgroundColor: `${statusColor}22` }]}
                className="absolute h-[84px] w-[84px] rounded-full"
              />
              <HudRing size={100} color={statusColor} strokeWidth={1.5} dash="22 10 4 10" duration={!focused ? 0 : status === 'thinking' ? 2500 : 9000} />
              <HudRing size={90} color={statusColor} strokeWidth={1} ticks={36} tickLength={2.5} duration={focused ? 16000 : 0} reverse opacity={0.5} />
              <Pressable
                onPress={handleMicPress}
                onPressIn={handleMicPressIn}
                onPressOut={handleMicPressOut}
                accessibilityLabel={settings.pushToTalk ? 'Hold to talk' : 'Tap to talk'}
                accessibilityHint={
                  settings.pushToTalk ? 'Press and hold to speak, release to send' : 'Tap to speak, tap again to send'
                }
                className="h-[70px] w-[70px] items-center justify-center rounded-full active:scale-95"
                style={{
                  backgroundColor: HUD.holo,
                  shadowColor: HUD.holo,
                  shadowOpacity: 0.7,
                  shadowRadius: 18,
                  elevation: 10,
                }}
              >
                <Mic size={27} color={HUD.onHolo} strokeWidth={2.2} />
              </Pressable>
            </View>

            <Pressable
              onPress={endCall}
              accessibilityLabel="End call"
              className="h-[56px] w-[56px] items-center justify-center rounded-full active:scale-95"
              style={{ backgroundColor: HUD.crimson }}
            >
              <PhoneOff size={21} color="#FFFFFF" strokeWidth={2} />
            </Pressable>
          </View>

          <Text style={[MONO, { color: HUD.textDim }]} className="mt-2 text-center text-[9.5px] tracking-[2.5px]">
            {status === 'listening'
              ? settings.pushToTalk
                ? 'RELEASE TO SEND'
                : 'TAP TO SEND'
              : status === 'speaking'
                ? 'TALK TO INTERRUPT'
                : wakeArmed
                  ? 'SAY “HEY KURISU” · OR USE THE CORE'
                  : settings.pushToTalk
                  ? 'HOLD THE CORE TO TALK'
                  : 'TAP THE CORE TO TALK'}
          </Text>
        </View>
      </SafeAreaView>
    </View>
  );
}
