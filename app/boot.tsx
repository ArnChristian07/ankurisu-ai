import { router } from 'expo-router';
import { Mic } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInLeft,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GridBackground } from '@/components/GridBackground';
import { HudFrame } from '@/components/hud/HudFrame';
import { HudRing } from '@/components/hud/HudRing';
import { Scanlines } from '@/components/hud/Scanlines';
import { SegmentBar } from '@/components/hud/SegmentBar';
import { HUD, MONO } from '@/constants/theme';
import { BRAIN_MODEL } from '@/constants/models';
import { BrainStatus, useAppState } from '@/context/AppContext';
import { sttSupported } from '@/services/voice';

interface BootLine {
  time: string;
  label: string;
  status: 'OK' | 'OFF' | 'WARN';
}

function buildBootLines({
  brainStatus,
  webSearch,
  notesCount,
  attitude,
  micReady,
}: {
  brainStatus: BrainStatus;
  webSearch: boolean;
  notesCount: number;
  attitude: number;
  micReady: boolean;
}): BootLine[] {
  const linked = brainStatus === 'ready' || brainStatus === 'checking';
  const brainLine: BootLine = linked
    ? { time: '00.177', label: `link ${BRAIN_MODEL.id}`, status: 'OK' }
    : brainStatus === 'error'
      ? { time: '00.177', label: 'gemini key rejected → settings', status: 'WARN' }
      : { time: '00.177', label: 'gemini api key missing → settings', status: 'WARN' };
  return [
    { time: '00.012', label: 'kernel ankurisu-core v0.3.0', status: 'OK' },
    { time: '00.048', label: 'mount /data/lab (sqlite kv)', status: 'OK' },
    { time: '00.103', label: 'net uplink generativelanguage.googleapis.com', status: 'OK' },
    brainLine,
    { time: '00.402', label: 'tool google_search grounding', status: linked && webSearch ? 'OK' : 'OFF' },
    { time: '00.511', label: 'load stt.on-device', status: micReady ? 'OK' : 'WARN' },
    { time: '00.596', label: 'load tts.system voice=kurisu', status: 'OK' },
    { time: '00.640', label: 'load mood-parser 16 labels', status: 'OK' },
    { time: '00.701', label: `index lab-notes ${notesCount} entries`, status: 'OK' },
    { time: '00.744', label: 'bind sprite-map 16/16 sprites', status: 'OK' },
    { time: '00.802', label: `check personality.tsundere = ${attitude.toFixed(1)}`, status: 'OK' },
    { time: '00.913', label: 'link voice channel ready', status: 'OK' },
  ];
}

const STATUS_COLORS: Record<BootLine['status'], string> = {
  OK: HUD.ok,
  OFF: HUD.off,
  WARN: HUD.warn,
};

export default function BootScreen() {
  const { brain, settings, notes } = useAppState();
  const BOOT_LINES = buildBootLines({
    brainStatus: brain.status,
    webSearch: settings.webKnowledge,
    notesCount: notes.length,
    attitude: settings.attitude,
    micReady: sttSupported(),
  });
  const [visibleCount, setVisibleCount] = useState(1);
  const cursorOpacity = useSharedValue(1);

  useEffect(() => {
    cursorOpacity.value = withRepeat(
      withSequence(withTiming(0, { duration: 420 }), withTiming(1, { duration: 420 })),
      -1,
      true
    );
  }, [cursorOpacity]);

  useEffect(() => {
    if (visibleCount >= BOOT_LINES.length) return;
    const timer = setTimeout(() => {
      setVisibleCount((c) => Math.min(BOOT_LINES.length, c + 1));
    }, 110);
    return () => clearTimeout(timer);
  }, [visibleCount, BOOT_LINES.length]);

  const cursorStyle = useAnimatedStyle(() => ({ opacity: cursorOpacity.value }));

  const isReady = visibleCount >= BOOT_LINES.length;
  const progress = visibleCount / BOOT_LINES.length;
  const percent = Math.round(progress * 100);

  return (
    <View className="flex-1" style={{ backgroundColor: HUD.bg }}>
      <GridBackground glowY="20%" />
      <Scanlines />

      <SafeAreaView className="flex-1 justify-between px-6 pb-6 pt-3">
        <View>
          {/* Header */}
          <View className="mb-6 flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <View className="h-[7px] w-[7px]" style={{ backgroundColor: HUD.crimson }} />
              <Text style={[MONO, { color: HUD.textMuted }]} className="text-[11px] tracking-[2px]">
                ANKURISU://BOOT
              </Text>
            </View>
            <View className="flex-row items-center gap-2">
              <View className="h-[6px] w-[6px] rounded-full" style={{ backgroundColor: HUD.ok }} />
              <Text style={[MONO, { color: HUD.textMuted }]} className="text-[11px] tracking-[2px]">
                CLOUD LINK
              </Text>
            </View>
          </View>

          {/* Core progress ring */}
          <Animated.View entering={FadeIn.duration(500)} className="mb-7 flex-row items-center gap-5">
            <View style={{ width: 112, height: 112 }} className="items-center justify-center">
              <HudRing size={112} strokeWidth={1} opacity={0.25} />
              <HudRing size={112} strokeWidth={3} progress={progress} />
              <HudRing size={92} strokeWidth={1} ticks={48} tickLength={3} duration={20000} reverse opacity={0.5} />
              <HudRing size={70} strokeWidth={1.2} dash="30 14" duration={6000} opacity={0.8} />
              <Text style={[MONO, { color: HUD.text }]} className="text-[20px]">
                {percent}
                <Text style={{ color: HUD.holoDim }} className="text-[12px]">%</Text>
              </Text>
            </View>
            <View className="flex-1 gap-1.5">
              <Text style={[MONO, { color: HUD.holo }]} className="text-[10px] tracking-[2.5px]">
                {isReady ? 'ALL SYSTEMS NOMINAL' : 'ESTABLISHING LINK'}
              </Text>
              <Text className="text-[22px] font-bold" style={{ color: HUD.text }}>
                {isReady ? 'Ready to link.' : 'Initializing…'}
              </Text>
              <Text style={[MONO, { color: HUD.textDim }]} className="text-[10.5px]">
                {BOOT_LINES[Math.min(visibleCount, BOOT_LINES.length) - 1].label}
              </Text>
            </View>
          </Animated.View>

          {/* Log */}
          <HudFrame label="SYSTEM LOG" meta={`${visibleCount}/${BOOT_LINES.length}`} className="px-4 pb-4 pt-5">
            <View className="gap-2">
              {BOOT_LINES.slice(0, visibleCount).map((line) => (
                <Animated.View
                  key={line.time}
                  entering={FadeInLeft.duration(160)}
                  className="flex-row items-center justify-between"
                >
                  <View className="flex-1 flex-row items-center pr-2">
                    <Text style={[MONO, { color: HUD.textDim }]} className="w-[52px] text-[11px]">
                      {line.time}
                    </Text>
                    <Text style={[MONO, { color: '#B9D3E6' }]} numberOfLines={1} className="flex-1 text-[11.5px]">
                      {line.label}
                    </Text>
                  </View>
                  <Text
                    style={[MONO, { color: STATUS_COLORS[line.status], borderColor: STATUS_COLORS[line.status] }]}
                    className="min-w-[44px] border px-1 text-center text-[9.5px] tracking-[1px]"
                  >
                    {line.status}
                  </Text>
                </Animated.View>
              ))}
              {!isReady && (
                <Animated.View
                  style={[cursorStyle, { backgroundColor: HUD.holo }]}
                  className="mt-0.5 h-[14px] w-[8px]"
                />
              )}
            </View>
          </HudFrame>
        </View>

        <View>
          <View className="mb-5">
            <SegmentBar value={progress} segments={28} height={6} />
          </View>

          <Pressable
            disabled={!isReady}
            onPress={() => router.replace('/voice')}
            className="active:opacity-85"
            style={{ opacity: isReady ? 1 : 0.35 }}
          >
            <HudFrame
              corner={12}
              color={HUD.text}
              panel={false}
              style={{ backgroundColor: HUD.holo }}
              className="flex-row items-center justify-center gap-2.5 py-4"
            >
              <Mic size={18} color={HUD.onHolo} strokeWidth={2.2} />
              <Text style={[MONO, { color: HUD.onHolo }]} className="text-[13.5px] tracking-[3px]">
                OPEN VOICE LINK
              </Text>
            </HudFrame>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}
