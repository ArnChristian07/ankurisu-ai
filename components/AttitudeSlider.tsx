import React, { useRef, useState } from 'react';
import { GestureResponderEvent, LayoutChangeEvent, View } from 'react-native';

import { HUD } from '@/constants/theme';

interface AttitudeSliderProps {
  value: number; // 0..1
  onChange: (next: number) => void;
}

export function AttitudeSlider({ value, onChange }: AttitudeSliderProps) {
  const [trackWidth, setTrackWidth] = useState(260);
  const trackXRef = useRef(0);
  const trackRef = useRef<React.ComponentRef<typeof View>>(null);

  const clamp = (n: number) => Math.max(0, Math.min(1, n));

  const updateFromPageX = (pageX: number) => {
    if (trackWidth <= 0) return;
    const ratio = clamp((pageX - trackXRef.current) / trackWidth);
    onChange(Math.round(ratio * 20) / 20);
  };

  const handleGrant = (evt: GestureResponderEvent) => {
    const pageX = evt.nativeEvent.pageX;
    trackRef.current?.measureInWindow((x) => {
      trackXRef.current = x;
      if (trackWidth <= 0) return;
      const ratio = clamp((pageX - x) / trackWidth);
      onChange(Math.round(ratio * 20) / 20);
    });
  };

  const handleMove = (evt: GestureResponderEvent) => {
    updateFromPageX(evt.nativeEvent.pageX);
  };

  const onLayout = (e: LayoutChangeEvent) => {
    setTrackWidth(e.nativeEvent.layout.width);
    trackRef.current?.measureInWindow((x) => {
      trackXRef.current = x;
    });
  };

  const percent = `${Math.round(clamp(value) * 100)}%` as `${number}%`;

  return (
    <View
      ref={trackRef}
      onLayout={onLayout}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={handleGrant}
      onResponderMove={handleMove}
      className="h-8 justify-center"
    >
      {/* Tick marks */}
      <View pointerEvents="none" className="absolute left-0 right-0 flex-row justify-between" style={{ top: 4 }}>
        {Array.from({ length: 21 }).map((_, i) => (
          <View
            key={i}
            style={{
              width: 1,
              height: i % 5 === 0 ? 6 : 3,
              backgroundColor: i / 20 <= value ? HUD.holoDim : HUD.line,
            }}
          />
        ))}
      </View>
      <View className="h-[3px] w-full" style={{ backgroundColor: HUD.line }}>
        <View style={{ width: percent, backgroundColor: HUD.holo }} className="h-full" />
      </View>
      <View
        pointerEvents="none"
        style={{
          left: percent,
          marginLeft: -8,
          borderColor: HUD.holo,
          backgroundColor: HUD.bg,
          transform: [{ rotate: '45deg' }],
          shadowColor: HUD.holo,
          shadowOpacity: 0.8,
          shadowRadius: 8,
        }}
        className="absolute h-[16px] w-[16px] items-center justify-center border-2"
      >
        <View className="h-[5px] w-[5px]" style={{ backgroundColor: HUD.holo }} />
      </View>
    </View>
  );
}
