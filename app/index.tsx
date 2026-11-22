import { router } from 'expo-router';
import React, { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, {
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
import { NixieReadout } from '@/components/hud/NixieReadout';
import { HudFrame } from '@/components/hud/HudFrame';
import { Scanlines } from '@/components/hud/Scanlines';
import { PulseLogo } from '@/components/PulseLogo';
import { HUD, MONO } from '@/constants/theme';

export default function SplashScreen() {
  const cursorOpacity = useSharedValue(1);

  useEffect(() => {
    cursorOpacity.value = withRepeat(
      withSequence(withTiming(0.15, { duration: 520 }), withTiming(1, { duration: 520 })),
      -1,
      true
    );
  }, [cursorOpacity]);

  const cursorStyle = useAnimatedStyle(() => ({ opacity: cursorOpacity.value }));

  return (
    <View className="flex-1" style={{ backgroundColor: HUD.bg }}>
      <GridBackground glowY="38%" />
      <Scanlines />

      <SafeAreaView className="flex-1 justify-between px-6 py-4">
        {/* System header */}
        <Animated.View entering={FadeIn.duration(500)} className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-2">
            <View className="h-[7px] w-[7px]" style={{ backgroundColor: HUD.crimson }} />
            <Text style={[MONO, { color: HUD.crimson }]} className="text-[11px] tracking-[3px]">
              ANKURISU
            </Text>
            <Text style={[MONO, { color: HUD.textDim }]} className="text-[11px] tracking-[1px]">
              {'// SYS'}
            </Text>
          </View>
          <Text style={[MONO, { color: HUD.textDim }]} className="text-[11px] tracking-[1.5px]">
            LAB-01
          </Text>
        </Animated.View>

        <Animated.View entering={FadeIn.duration(800)} className="items-center">
          <PulseLogo size={210} />

          <Text
            className="mt-7 text-[34px] font-bold tracking-[1px]"
            style={{ color: HUD.text }}
          >
            AnKurisu<Text style={{ color: HUD.holo }}> AI</Text>
          </Text>
          <Text style={[MONO, { color: HUD.textMuted }]} className="mt-1.5 text-[11px] tracking-[3px]">
            AI LAB ASSISTANT
          </Text>

          <View className="mt-8 items-center">
            <Text style={[MONO, { color: HUD.textDim }]} className="mb-2.5 text-[9.5px] tracking-[3px]">
              CORE SYNC
            </Text>
            <NixieReadout value="0.982417" size={34} />
          </View>

          <View className="mt-8 flex-row items-center gap-3">
            {['POWERED BY GEMINI', 'LIVE WEB SEARCH'].map((chip) => (
              <HudFrame key={chip} corner={6} color={HUD.holoDim} className="px-3.5 py-1.5">
                <Text style={[MONO, { color: HUD.textMuted }]} className="text-[10.5px] tracking-[1.5px]">
                  {chip}
                </Text>
              </HudFrame>
            ))}
          </View>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(300).duration(600)} className="items-center pb-2">
          <Pressable onPress={() => router.push('/boot')} className="active:opacity-80">
            <HudFrame corner={12} className="flex-row items-center px-10 py-4" style={{ backgroundColor: HUD.holoSoft, borderColor: HUD.holoDeep }}>
              <Text style={[MONO, { color: HUD.holo }]} className="text-[13px] tracking-[3px]">
                ▸ TAP TO INITIALIZE
              </Text>
              <Animated.Text style={[MONO, { color: HUD.holo }, cursorStyle]} className="text-[13px]">
                _
              </Animated.Text>
            </HudFrame>
          </Pressable>

          <Text style={[MONO, { color: HUD.textDim }]} className="mt-6 text-[10px] tracking-[2px]">
            BUILD 0.3.0 · GEMINI CORE
          </Text>
        </Animated.View>
      </SafeAreaView>
    </View>
  );
}
