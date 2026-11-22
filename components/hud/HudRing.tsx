import React, { memo, useEffect } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Line } from 'react-native-svg';

import { HUD } from '@/constants/theme';

export interface HudRingProps {
  size: number;
  color?: string;
  strokeWidth?: number;
  /** SVG dash pattern, e.g. "40 12". Omit for a solid ring. */
  dash?: string;
  /** Number of radial tick marks drawn inside the ring. */
  ticks?: number;
  tickLength?: number;
  /** Full-rotation duration in ms. 0 disables rotation. */
  duration?: number;
  reverse?: boolean;
  opacity?: number;
  /** Fraction (0..1) of the ring to draw as a progress arc instead of a full ring. */
  progress?: number;
  style?: StyleProp<ViewStyle>;
}

export const HudRing = memo(function HudRing({
  size,
  color = HUD.holo,
  strokeWidth = 1.5,
  dash,
  ticks = 0,
  tickLength = 6,
  duration = 0,
  reverse = false,
  opacity = 1,
  progress,
  style,
}: HudRingProps) {
  const rotation = useSharedValue(0);

  useEffect(() => {
    if (duration <= 0) return;
    // Carry on from the current angle: a speed change (e.g. idle → thinking) or resuming after a
    // pause must not snap the ring back to 0°.
    const from = rotation.value % 360;
    rotation.value = from;
    rotation.value = withRepeat(
      withTiming(from + (reverse ? -360 : 360), { duration, easing: Easing.linear }),
      -1,
      false
    );
    return () => cancelAnimation(rotation);
  }, [duration, reverse, rotation]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  const c = size / 2;
  const r = c - strokeWidth - (ticks ? 0 : 0.5);
  const circumference = 2 * Math.PI * r;

  const dashArray =
    progress !== undefined
      ? `${Math.max(0, Math.min(1, progress)) * circumference} ${circumference}`
      : dash;

  return (
    <Animated.View
      pointerEvents="none"
      // A spinning ring's SVG never changes, only its transform: cache it as a GPU layer so
      // the paths (up to 60 ticks) aren't re-drawn every frame.
      renderToHardwareTextureAndroid={duration > 0}
      shouldRasterizeIOS={duration > 0}
      style={[{ position: 'absolute', width: size, height: size, opacity }, style, animatedStyle]}
    >
      <Svg width={size} height={size}>
        <Circle
          cx={c}
          cy={c}
          r={r}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={dashArray}
          strokeLinecap={progress !== undefined ? 'round' : 'butt'}
          fill="none"
          transform={progress !== undefined ? `rotate(-90 ${c} ${c})` : undefined}
        />
        {Array.from({ length: ticks }).map((_, i) => {
          const a = (i / ticks) * Math.PI * 2;
          const major = i % 5 === 0;
          const len = major ? tickLength * 1.8 : tickLength;
          const r1 = r - 3;
          const r2 = r1 - len;
          return (
            <Line
              key={i}
              x1={c + Math.cos(a) * r1}
              y1={c + Math.sin(a) * r1}
              x2={c + Math.cos(a) * r2}
              y2={c + Math.sin(a) * r2}
              stroke={color}
              strokeWidth={major ? 1.4 : 0.8}
              opacity={major ? 0.9 : 0.5}
            />
          );
        })}
      </Svg>
    </Animated.View>
  );
});
