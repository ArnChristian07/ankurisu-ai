import React from 'react';
import { StyleProp, Text, View, ViewStyle } from 'react-native';

import { HUD, MONO } from '@/constants/theme';

interface HudFrameProps {
  children?: React.ReactNode;
  className?: string;
  style?: StyleProp<ViewStyle>;
  /** Bracket color. */
  color?: string;
  /** Bracket arm length. */
  corner?: number;
  /** Small tag rendered on the top edge, e.g. "TRANSCRIPT". */
  label?: string;
  labelColor?: string;
  /** Right-aligned tag on the top edge. */
  meta?: string;
  /** Draw a faint full border + panel fill behind the brackets. */
  panel?: boolean;
}

/** Panel with targeting-reticle corner brackets. */
export function HudFrame({
  children,
  className = '',
  style,
  color = HUD.holo,
  corner = 10,
  label,
  labelColor,
  meta,
  panel = true,
}: HudFrameProps) {
  const arm = { position: 'absolute' as const, width: corner, height: corner, borderColor: color };
  const w = 1.5;

  return (
    <View
      style={[
        panel && {
          backgroundColor: HUD.panel,
          borderWidth: 1,
          borderColor: HUD.lineDim,
        },
        style,
      ]}
      className={className}
    >
      <View pointerEvents="none" style={[arm, { top: -1, left: -1, borderTopWidth: w, borderLeftWidth: w }]} />
      <View pointerEvents="none" style={[arm, { top: -1, right: -1, borderTopWidth: w, borderRightWidth: w }]} />
      <View pointerEvents="none" style={[arm, { bottom: -1, left: -1, borderBottomWidth: w, borderLeftWidth: w }]} />
      <View pointerEvents="none" style={[arm, { bottom: -1, right: -1, borderBottomWidth: w, borderRightWidth: w }]} />

      {(label || meta) && (
        <View
          pointerEvents="none"
          className="absolute left-0 right-0 flex-row items-center justify-between"
          style={{ top: -7, paddingHorizontal: corner + 6 }}
        >
          {label ? (
            <Text
              style={[MONO, { color: labelColor ?? color, backgroundColor: HUD.bg }]}
              className="px-1.5 text-[9.5px] tracking-[2px]"
            >
              {label}
            </Text>
          ) : (
            <View />
          )}
          {meta ? (
            <Text
              style={[MONO, { color: HUD.textDim, backgroundColor: HUD.bg }]}
              className="px-1.5 text-[9.5px] tracking-[1.5px]"
            >
              {meta}
            </Text>
          ) : null}
        </View>
      )}

      {children}
    </View>
  );
}
