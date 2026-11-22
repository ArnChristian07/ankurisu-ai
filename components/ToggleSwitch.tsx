import React, { useEffect } from 'react';
import { Pressable } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { HUD } from '@/constants/theme';

interface ToggleSwitchProps {
  value: boolean;
  onValueChange: (next: boolean) => void;
}

export function ToggleSwitch({ value, onValueChange }: ToggleSwitchProps) {
  const progress = useSharedValue(value ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(value ? 1 : 0, { duration: 180 });
  }, [value, progress]);

  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], [HUD.bg, 'rgba(79,216,255,0.18)']),
    borderColor: interpolateColor(progress.value, [0, 1], [HUD.line, HUD.holo]),
  }));

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * 22 }],
    backgroundColor: interpolateColor(progress.value, [0, 1], [HUD.textDim, HUD.holo]),
  }));

  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      hitSlop={8}
    >
      <Animated.View
        style={trackStyle}
        className="h-[26px] w-[50px] justify-center rounded-[3px] border px-[3px]"
      >
        <Animated.View style={thumbStyle} className="h-[18px] w-[19px] rounded-[2px]" />
      </Animated.View>
    </Pressable>
  );
}
