import { router } from 'expo-router';
import { ArrowUp, ChevronLeft, Mic, Square } from 'lucide-react-native';
import React, { memo, useCallback, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
// The log is an inverted list (each cell is flipped vertically), so FadeInUp here moves the same
// way on screen as FadeInDown does elsewhere: bubbles rise in from below.
import Animated, { FadeInUp } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GridBackground } from '@/components/GridBackground';
import { ThinkingText } from '@/components/ThinkingText';
import { createTextSource, TypewriterText } from '@/components/TypewriterText';
import { HudFrame } from '@/components/hud/HudFrame';
import { HudIconButton } from '@/components/hud/HudIconButton';
import { HudRing } from '@/components/hud/HudRing';
import { KurisuMood, MOOD_COLORS, SPRITE_MAP } from '@/constants/sprites';
import { HUD, MONO } from '@/constants/theme';
import { ChatMessage, useAppState } from '@/context/AppContext';

const BUBBLE_TEXT = { color: '#DCEBF7' };
// Inverted: paddingTop shows at the bottom of the screen and vice versa.
const LIST_CONTENT = { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 16 };
const keyOf = (m: ChatMessage) => m.id;

function ItemGap() {
  return <View style={{ height: 20 }} />;
}

/** Sits at the top of the log (the inverted list's footer). */
function LogHeader() {
  return (
    // mt-6 inside the flipped cell = the gap below the divider on screen.
    <View className="mt-6 flex-row items-center gap-3">
      <View className="h-[1px] flex-1" style={{ backgroundColor: HUD.lineDim }} />
      <Text style={[MONO, { color: HUD.textDim }]} className="text-[9.5px] tracking-[2px]">
        TEXT LOG · STORED ON DEVICE
      </Text>
      <View className="h-[1px] flex-1" style={{ backgroundColor: HUD.lineDim }} />
    </View>
  );
}

/** Memoized so typing in the input or streaming a reply doesn't re-render the whole log. */
const MessageBubble = memo(function MessageBubble({
  msg,
  typing,
  startAt,
  onTyped,
  animateIn,
}: {
  msg: ChatMessage;
  /** Play the entering animation. Off for history already on screen when the log opens. */
  animateIn: boolean;
  /** This is the reply that just finished streaming — keep typing it out from `startAt`. */
  typing: boolean;
  startAt: number;
  onTyped: () => void;
}) {
  if (msg.sender === 'user') {
    return (
      <Animated.View entering={animateIn ? FadeInUp.duration(220) : undefined} className="max-w-[82%] self-end">
        <Text style={[MONO, { color: HUD.textDim }]} className="mb-1 text-right text-[9px] tracking-[2px]">
          YOU
        </Text>
        <View
          className="px-4 py-3"
          style={{
            backgroundColor: '#0C1A28',
            borderRightWidth: 2,
            borderColor: HUD.holoDim,
          }}
        >
          <Text className="text-[15px] leading-[22px]" style={{ color: HUD.text }}>
            {msg.text}
          </Text>
        </View>
      </Animated.View>
    );
  }

  const mood = msg.mood ?? 'happy';
  return (
    // No entering animation for the hand-off bubble: it replaces the streaming one in place.
    <Animated.View
      entering={animateIn && !typing ? FadeInUp.duration(220) : undefined}
      className="max-w-[86%] self-start"
    >
      <HudFrame corner={8} label="KURISU" meta={mood.toUpperCase()} color={MOOD_COLORS[mood]} className="px-4 pb-3.5 pt-4">
        <TypewriterText
          text={msg.text}
          animate={typing}
          startAt={startAt}
          cursorColor={MOOD_COLORS[mood]}
          onDone={onTyped}
          className="text-[15px] leading-[22px]"
          style={BUBBLE_TEXT}
        />
      </HudFrame>
      {msg.actionResult && <ActionChip {...msg.actionResult} />}
    </Animated.View>
  );
});

/** What her ACTION line did: "✓ TIMER · 10:00 · pasta" or "✕ REMIND · …". */
function ActionChip({ ok, label }: { ok: boolean; label: string }) {
  const color = ok ? HUD.ok : HUD.warn;
  return (
    <View
      className="mt-1.5 flex-row items-center gap-2 self-start px-2.5 py-1"
      style={{ borderWidth: 1, borderColor: color, backgroundColor: HUD.panelSolid }}
    >
      <Text style={[MONO, { color }]} className="text-[10px]">
        {ok ? '✓' : '✕'}
      </Text>
      <Text style={[MONO, { color: HUD.text }]} numberOfLines={1} className="text-[10px] tracking-[1px]">
        {label}
      </Text>
    </View>
  );
}

export default function ChatScreen() {
  const { messages, ask, isGenerating, stopGenerating, brain, triggerMoodHaptic } = useAppState();
  const [draft, setDraft] = useState('');
  // Only mood / "has text yet" live in state; the streamed text itself goes to `streamSource`.
  const [pending, setPending] = useState<{ mood: KurisuMood; started: boolean } | null>(null);
  const [waiting, setWaiting] = useState(false);
  /** The just-finished reply, still typing out from `at` characters (where the stream got to). */
  const [typing, setTyping] = useState<{ id: string; at: number } | null>(null);
  const [streamSource] = useState(() => createTextSource());
  const revealedRef = useRef(0);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  // Opening the log with up to 200 stored messages shouldn't run 200 entering animations at once.
  const [historyIds] = useState(() => new Set(messages.map((m) => m.id)));

  const handleSend = async () => {
    const trimmed = draft.trim();
    if (!trimmed || waiting) return;
    setDraft('');
    setWaiting(true);
    setTyping(null);
    streamSource.set('');
    revealedRef.current = 0;
    // Sending jumps back to the newest message (offset 0 is the bottom of an inverted list).
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
    let last = { mood: 'curious' as KurisuMood, started: false };
    setPending(last);
    try {
      const reply = await ask(trimmed, (partial) => {
        streamSource.set(partial.text);
        const started = partial.text.length > 0;
        if (partial.mood !== last.mood || started !== last.started) {
          last = { mood: partial.mood, started };
          setPending(last);
        }
      });
      // Hand off to the saved message, which keeps typing from where the stream got to.
      setTyping({ id: reply.id, at: revealedRef.current });
      triggerMoodHaptic();
    } finally {
      setPending(null);
      setWaiting(false);
    }
  };

  const handleTyped = useCallback(() => setTyping(null), []);

  // Newest first: the inverted list renders from the bottom, so opening a long log only lays out
  // the bubbles that fit on screen instead of all of them.
  const reversed = useMemo(() => [...messages].reverse(), [messages]);

  const renderItem = useCallback(
    ({ item }: { item: ChatMessage }) => (
      <MessageBubble
        msg={item}
        typing={item.id === typing?.id}
        startAt={item.id === typing?.id ? typing.at : 0}
        onTyped={handleTyped}
        animateIn={!historyIds.has(item.id)}
      />
    ),
    [typing, handleTyped, historyIds]
  );

  // The streaming reply sits below the newest message (the inverted list's header).
  const pendingBubble = pending ? (
    <Animated.View entering={FadeInUp.duration(220)} className="mb-5 max-w-[86%] self-start">
      <HudFrame
        corner={8}
        label="KURISU"
        meta={pending.started ? pending.mood.toUpperCase() : 'THINKING'}
        color={MOOD_COLORS[pending.mood]}
        className="px-4 pb-3.5 pt-4"
      >
        {pending.started ? (
          <TypewriterText
            source={streamSource}
            streaming
            revealedRef={revealedRef}
            cursorColor={MOOD_COLORS[pending.mood]}
            className="text-[15px] leading-[22px]"
            style={BUBBLE_TEXT}
          />
        ) : (
          <ThinkingText className="text-[15px] italic leading-[22px]" style={{ color: HUD.textMuted }} />
        )}
      </HudFrame>
    </Animated.View>
  ) : undefined;

  // Header avatar: thinking sprite until the first token, then the streaming mood, then her last mood.
  const thinking = pending !== null && !pending.started;
  const lastMood = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].sender === 'kurisu') return messages[i].mood ?? 'happy';
    }
    return 'happy';
  }, [messages]);
  const avatarMood: KurisuMood = thinking ? 'curious' : (pending?.mood ?? lastMood);

  const brainLabel = thinking
    ? 'THINKING…'
    : brain.status === 'ready'
      ? `ON-DEVICE · ${brain.tokensPerSecond ? `${brain.tokensPerSecond.toFixed(0)} TOK/S` : 'READY'}`
      : brain.status === 'checking'
        ? 'STARTING…'
        : brain.status === 'unsupported'
          ? 'NEEDS A DEVELOPMENT BUILD'
          : 'NO BRAIN · DOWNLOAD IT IN SETTINGS';

  return (
    <View className="flex-1" style={{ backgroundColor: HUD.bg }}>
      <GridBackground glowY="0%" />
      <SafeAreaView className="flex-1">
        {/* Header */}
        <View
          className="flex-row items-center justify-between px-4 py-3"
          style={{ borderBottomWidth: 1, borderColor: HUD.lineDim }}
        >
          <View className="flex-1 flex-row items-center gap-3">
            <Pressable
              onPress={() => router.back()}
              hitSlop={10}
              accessibilityLabel="Back"
              className="h-10 w-7 items-center justify-center active:opacity-70"
            >
              <ChevronLeft size={24} color={HUD.text} />
            </Pressable>

            <View style={{ width: 46, height: 46 }} className="items-center justify-center">
              <HudRing size={46} strokeWidth={1.2} dash="18 6" duration={10000} opacity={0.8} />
              <View
                className="h-[38px] w-[38px] items-center overflow-hidden rounded-full"
                style={{ backgroundColor: HUD.panelSolid }}
              >
                <Image
                  source={SPRITE_MAP[avatarMood]}
                  resizeMode="contain"
                  style={{ width: 92, height: 164, marginTop: -8 }}
                />
              </View>
            </View>

            <View className="flex-1 pr-2">
              <Text className="text-[17px] font-bold" style={{ color: HUD.text }}>
                AnKurisu
              </Text>
              <Text style={[MONO, { color: HUD.textMuted }]} numberOfLines={1} className="text-[10px] tracking-[1px]">
                {brainLabel}
              </Text>
            </View>
          </View>

          <HudIconButton onPress={() => router.back()} accessibilityLabel="Back to voice">
            <Mic size={19} color={HUD.holo} strokeWidth={1.8} />
          </HudIconButton>
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          className="flex-1"
        >
          <FlatList
            ref={listRef}
            inverted
            data={reversed}
            keyExtractor={keyOf}
            renderItem={renderItem}
            extraData={typing}
            ItemSeparatorComponent={ItemGap}
            ListHeaderComponent={pendingBubble}
            ListFooterComponent={LogHeader}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={LIST_CONTENT}
            initialNumToRender={12}
            maxToRenderPerBatch={8}
            windowSize={9}
          />

          {/* Input */}
          <View className="flex-row items-center gap-3 px-4 pb-4 pt-2">
            <HudFrame corner={8} color={HUD.holoDim} className="flex-1 flex-row items-center px-4 py-1">
              <Text style={[MONO, { color: HUD.holo }]} className="mr-2 text-[14px]">
                &gt;
              </Text>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                onSubmitEditing={handleSend}
                placeholder="Message AnKurisu…"
                placeholderTextColor={HUD.textDim}
                returnKeyType="send"
                className="flex-1 py-2.5 text-[15px]"
                style={{ color: HUD.text }}
              />
            </HudFrame>

            <Pressable
              onPress={isGenerating ? stopGenerating : handleSend}
              accessibilityLabel={isGenerating ? 'Stop' : 'Send'}
              className="mx-1.5 h-10 w-10 items-center justify-center active:opacity-80"
              style={{ backgroundColor: HUD.holo, transform: [{ rotate: '45deg' }], borderRadius: 6 }}
            >
              <View style={{ transform: [{ rotate: '-45deg' }] }}>
                {isGenerating ? (
                  <Square size={16} color={HUD.onHolo} fill={HUD.onHolo} />
                ) : (
                  <ArrowUp size={20} color={HUD.onHolo} strokeWidth={2.4} />
                )}
              </View>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
