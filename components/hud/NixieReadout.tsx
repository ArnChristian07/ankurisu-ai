import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { HUD, MONO } from '@/constants/theme';

interface NixieReadoutProps {
  value: string;
  /** Height of each nixie tube. */
  size?: number;
  /** Scramble the digits before settling on the value. */
  scramble?: boolean;
}

const randDigit = () => Math.floor(Math.random() * 10).toString();

/** Nixie-tube style numeric readout. */
export function NixieReadout({
  value,
  size = 34,
  scramble = true,
}: NixieReadoutProps) {
  const [shown, setShown] = useState(() =>
    scramble ? value.replace(/\d/g, randDigit) : value
  );

  useEffect(() => {
    if (!scramble) return;
    let tick = 0;
    const settleAt = value.split('').map((_, i) => 8 + i * 3);
    const id = setInterval(() => {
      tick += 1;
      setShown(
        value
          .split('')
          .map((ch, i) => (ch === '.' || tick >= settleAt[i] ? ch : randDigit()))
          .join('')
      );
      if (tick >= settleAt[settleAt.length - 1]) clearInterval(id);
    }, 55);
    return () => clearInterval(id);
  }, [scramble, value]);

  const tubeW = size * 0.62;

  return (
    <View className="flex-row items-end" style={{ gap: size * 0.1 }}>
      {(scramble ? shown : value).split('').map((ch, i) =>
        ch === '.' ? (
          <View key={i} style={{ width: size * 0.18, height: size, justifyContent: 'flex-end' }}>
            <View
              style={{
                width: size * 0.13,
                height: size * 0.13,
                borderRadius: size,
                backgroundColor: HUD.nixie,
                marginBottom: size * 0.12,
                shadowColor: HUD.nixie,
                shadowOpacity: 0.9,
                shadowRadius: 6,
              }}
            />
          </View>
        ) : (
          <View
            key={i}
            style={{
              width: tubeW,
              height: size,
              borderRadius: tubeW / 2.4,
              borderWidth: 1,
              borderColor: 'rgba(255,155,61,0.22)',
              backgroundColor: 'rgba(40,16,4,0.55)',
            }}
            className="items-center justify-center overflow-hidden"
          >
            <Text
              style={[
                MONO,
                {
                  color: HUD.nixie,
                  fontSize: size * 0.66,
                  lineHeight: size * 0.9,
                  textShadowColor: 'rgba(255,120,30,0.95)',
                  textShadowRadius: 10,
                  textShadowOffset: { width: 0, height: 0 },
                },
              ]}
            >
              {ch}
            </Text>
          </View>
        )
      )}
    </View>
  );
}
