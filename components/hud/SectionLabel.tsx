import React from 'react';
import { Text, View } from 'react-native';

import { HUD, MONO } from '@/constants/theme';

/** "[01] PERSONALITY ————" style section header. */
export function SectionLabel({
  index,
  title,
  className = '',
}: {
  index?: string;
  title: string;
  className?: string;
}) {
  return (
    <View className={`flex-row items-center gap-2 ${className}`}>
      {index && (
        <Text style={[MONO, { color: HUD.holo }]} className="text-[10.5px] tracking-[1px]">
          [{index}]
        </Text>
      )}
      <Text style={[MONO, { color: HUD.textMuted }]} className="text-[10.5px] tracking-[2.5px]">
        {title}
      </Text>
      <View className="h-[1px] flex-1" style={{ backgroundColor: HUD.line }} />
      <View className="h-[3px] w-[3px]" style={{ backgroundColor: HUD.holoDim }} />
    </View>
  );
}
