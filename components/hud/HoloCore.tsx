import React, { memo } from 'react';
import { View } from 'react-native';

import { HUD } from '@/constants/theme';
import { HudRing } from './HudRing';

interface HoloCoreProps {
  size: number;
  color?: string;
  /** Multiplier for all ring speeds; 0 freezes the rings. */
  speed?: number;
  opacity?: number;
  children?: React.ReactNode;
}

/**
 * Stack of counter-rotating segmented rings — the JARVIS "arc" core.
 * Children render centered inside.
 */
export const HoloCore = memo(function HoloCore({
  size,
  color = HUD.holo,
  speed = 1,
  opacity = 1,
  children,
}: HoloCoreProps) {
  const d = (ms: number) => (speed > 0 ? ms / speed : 0);

  return (
    <View
      style={{ width: size, height: size, opacity }}
      className="items-center justify-center"
    >
      <HudRing size={size} color={color} strokeWidth={1} opacity={0.35} />
      <HudRing
        size={size}
        color={color}
        strokeWidth={2}
        dash={`${size * 0.42} ${size * 0.12} ${size * 0.08} ${size * 0.12}`}
        duration={d(26000)}
        opacity={0.85}
      />
      <HudRing
        size={size * 0.86}
        color={color}
        strokeWidth={1}
        ticks={60}
        tickLength={size * 0.022}
        duration={d(48000)}
        reverse
        opacity={0.55}
      />
      <HudRing
        size={size * 0.7}
        color={color}
        strokeWidth={3}
        dash={`${size * 0.05} ${size * 0.035}`}
        duration={d(18000)}
        opacity={0.5}
      />
      <HudRing
        size={size * 0.58}
        color={color}
        strokeWidth={1.2}
        dash={`${size * 0.6} ${size * 0.3}`}
        duration={d(9000)}
        reverse
        opacity={0.9}
      />
      {children}
    </View>
  );
});
