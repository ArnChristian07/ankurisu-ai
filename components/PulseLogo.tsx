import React, { memo, useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { HoloCore } from '@/components/hud/HoloCore';
import { HUD } from '@/constants/theme';

export const PulseLogo = memo(function PulseLogo({ size = 200 }: { size?: number }) {
  const glow = useSharedValue(0.6);

  useEffect(() => {
    glow.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.6, { duration: 1400, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );
  }, [glow]);

  const coreStyle = useAnimatedStyle(() => ({
    opacity: glow.value,
    transform: [{ scale: 0.96 + glow.value * 0.06 }],
  }));

  const inner = size * 0.44;

  return (
    <HoloCore size={size}>
      <Animated.View
        style={[
          {
            width: inner,
            height: inner,
            borderRadius: inner / 2,
            backgroundColor: 'rgba(79,216,255,0.08)',
            borderWidth: 1,
            borderColor: 'rgba(79,216,255,0.45)',
            shadowColor: HUD.holo,
            shadowOpacity: 0.8,
            shadowRadius: 24,
          },
          coreStyle,
        ]}
        className="items-center justify-center"
      >
        <View>
          <Svg width={inner * 0.55} height={inner * 0.55} viewBox="0 0 24 24" fill="none">
            <Path
              d="M2.5 12H6.5L8.8 6.5L12 18L15.2 9.5L17.2 12H21.5"
              stroke={HUD.holo}
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </View>
      </Animated.View>
    </HoloCore>
  );
});
