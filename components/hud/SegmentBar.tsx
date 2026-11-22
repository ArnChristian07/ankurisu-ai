import React from 'react';
import { View } from 'react-native';

import { HUD } from '@/constants/theme';

/** Segmented HUD meter. `value` is 0..1. */
export function SegmentBar({
  value,
  segments = 24,
  height = 8,
  color = HUD.holo,
}: {
  value: number;
  segments?: number;
  height?: number;
  color?: string;
}) {
  const lit = Math.round(Math.max(0, Math.min(1, value)) * segments);
  return (
    <View className="flex-row" style={{ gap: 3, height }}>
      {Array.from({ length: segments }).map((_, i) => {
        const on = i < lit;
        const head = i === lit - 1;
        return (
          <View
            key={i}
            style={{
              flex: 1,
              backgroundColor: on ? color : HUD.lineDim,
              opacity: on ? (head ? 1 : 0.55 + (i / segments) * 0.4) : 1,
              transform: [{ skewX: '-18deg' }],
            }}
          />
        );
      })}
    </View>
  );
}
