import { LinearGradient } from 'expo-linear-gradient';
import React, { memo, useEffect } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, Line, Pattern, Rect } from 'react-native-svg';

/** CRT scanlines + a slow holographic sweep bar. Purely decorative. */
export const Scanlines = memo(function Scanlines({ sweep = true }: { sweep?: boolean }) {
  const { height } = useWindowDimensions();
  const y = useSharedValue(-120);

  useEffect(() => {
    if (!sweep) return;
    y.value = withRepeat(
      withDelay(
        1800,
        withTiming(height + 120, { duration: 5200, easing: Easing.inOut(Easing.quad) })
      ),
      -1,
      false
    );
    return () => cancelAnimation(y);
  }, [height, sweep, y]);

  const sweepStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value }],
  }));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern id="scan" width="4" height="3" patternUnits="userSpaceOnUse">
            <Line x1="0" y1="0.5" x2="4" y2="0.5" stroke="#9BE7FF" strokeWidth="1" opacity="0.035" />
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#scan)" />
      </Svg>
      {sweep && (
        <Animated.View
          style={[{ position: 'absolute', left: 0, right: 0, height: 120 }, sweepStyle]}
        >
          <LinearGradient
            colors={['transparent', 'rgba(79,216,255,0.05)', 'rgba(79,216,255,0.09)', 'transparent']}
            locations={[0, 0.7, 0.92, 1]}
            style={{ flex: 1 }}
          />
        </Animated.View>
      )}
    </View>
  );
});
