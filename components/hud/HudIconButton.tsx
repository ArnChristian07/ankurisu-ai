import React from 'react';
import { Pressable } from 'react-native';

import { HUD } from '@/constants/theme';
import { HudFrame } from './HudFrame';

/** Square icon button with reticle brackets. */
export function HudIconButton({
  onPress,
  children,
  size = 44,
  accessibilityLabel,
}: {
  onPress: () => void;
  children: React.ReactNode;
  size?: number;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      className="active:opacity-70"
    >
      <HudFrame
        corner={8}
        color={HUD.holoDim}
        style={{ width: size, height: size }}
        className="items-center justify-center"
      >
        {children}
      </HudFrame>
    </Pressable>
  );
}
