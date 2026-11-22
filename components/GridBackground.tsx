import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Line, Pattern, RadialGradient, Rect, Stop } from 'react-native-svg';

import { HUD } from '@/constants/theme';

/** Holographic lab grid with a soft central glow and vignette. */
export const GridBackground = memo(function GridBackground({ glowY = '42%' }: { glowY?: string }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern id="labGrid" width="32" height="32" patternUnits="userSpaceOnUse">
            <Line x1="32" y1="0" x2="32" y2="32" stroke="#0C1B29" strokeWidth="1" />
            <Line x1="0" y1="32" x2="32" y2="32" stroke="#0C1B29" strokeWidth="1" />
            <Circle cx="32" cy="32" r="1.1" fill="#16405A" />
          </Pattern>
          <RadialGradient id="glow" cx="50%" cy={glowY} r="60%">
            <Stop offset="0%" stopColor="#0E3B55" stopOpacity="0.75" />
            <Stop offset="45%" stopColor="#071A28" stopOpacity="0.35" />
            <Stop offset="100%" stopColor={HUD.bg} stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="vignette" cx="50%" cy="50%" r="75%">
            <Stop offset="55%" stopColor={HUD.bg} stopOpacity="0" />
            <Stop offset="100%" stopColor="#000000" stopOpacity="0.85" />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={HUD.bg} />
        <Rect width="100%" height="100%" fill="url(#labGrid)" />
        <Rect width="100%" height="100%" fill="url(#glow)" />
        <Rect width="100%" height="100%" fill="url(#vignette)" />
      </Svg>
    </View>
  );
});
