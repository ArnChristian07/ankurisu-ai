import React, { memo, useEffect } from 'react';
import { View } from 'react-native';

import { HUD } from '@/constants/theme';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

const BAR_PATTERN = [
  0.18, 0.25, 0.55, 0.35, 0.72, 0.45, 0.28, 0.16, 0.22, 0.42, 0.85, 0.65,
  0.48, 0.95, 0.62, 0.38, 0.78, 0.9, 0.54, 0.3, 0.48, 0.72, 0.88, 0.6,
  0.42, 0.24, 0.68, 0.48, 0.28, 0.18, 0.14,
];

const BAR_HEIGHT = 36;
const MIN_SCALE = 4 / BAR_HEIGHT;

function WaveformBar({
  baseHeight,
  index,
  active,
  color,
}: {
  baseHeight: number;
  index: number;
  active: boolean;
  color: string;
}) {
  const scaleY = useSharedValue(active ? baseHeight : 0.16);

  useEffect(() => {
    if (active) {
      const minVal = Math.max(0.15, baseHeight * 0.35);
      const maxVal = Math.min(1, baseHeight * 1.12);
      const duration = 260 + (index % 5) * 70;
      scaleY.value = withDelay(
        (index % 7) * 45,
        withRepeat(
          withSequence(
            withTiming(maxVal, { duration, easing: Easing.inOut(Easing.ease) }),
            withTiming(minVal, { duration: duration + 40, easing: Easing.inOut(Easing.ease) })
          ),
          -1,
          true
        )
      );
    } else {
      scaleY.value = withTiming(0.16 + (index % 3) * 0.04, {
        duration: 320,
        easing: Easing.out(Easing.ease),
      });
    }
  }, [active, baseHeight, index, scaleY]);

  // Scale a fixed-height bar instead of animating `height`: a transform is applied on the UI
  // thread without re-running layout for all 31 bars every frame.
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: Math.max(MIN_SCALE, scaleY.value) }],
    opacity: active ? 0.85 + scaleY.value * 0.15 : 0.45,
  }));

  return (
    <Animated.View
      style={[animatedStyle, { backgroundColor: color, height: BAR_HEIGHT }]}
      className="w-[2.5px] rounded-full"
    />
  );
}

export const WaveformVisualizer = memo(function WaveformVisualizer({
  active,
  color = HUD.holo,
}: {
  active: boolean;
  color?: string;
}) {
  return (
    <View className="h-10 flex-row items-center justify-center">
      <View className="mr-2 h-[1px] flex-1" style={{ backgroundColor: HUD.line }} />
      <View className="flex-row items-center gap-[4px]">
        {BAR_PATTERN.map((ratio, idx) => (
          <WaveformBar key={idx} baseHeight={ratio} index={idx} active={active} color={color} />
        ))}
      </View>
      <View className="ml-2 h-[1px] flex-1" style={{ backgroundColor: HUD.line }} />
    </View>
  );
});
