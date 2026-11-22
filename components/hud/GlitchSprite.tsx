import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ImageSourcePropType, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { HUD } from '@/constants/theme';

interface GlitchSpriteProps {
  source: ImageSourcePropType;
  /** Changes whenever the glitch should replay (e.g. the mood index). Also seeds the slice layout. */
  seed: number;
  width: number;
  height: number;
  /** Continuous hologram effects: scan lines across her body, data streaks, idle micro-glitches. */
  ambient?: boolean;
  /** Freeze every loop (e.g. while another screen covers this one) without unmounting the layers. */
  paused?: boolean;
}

const SLICE_COUNT = 4;
const SCAN_BANDS = 7;
const STREAKS = 10;
const CLOCK_MS = 7000;

/** Deterministic 0..1 pseudo-random so slice layout varies per mood without impure renders. */
function rand(seed: number, salt: number) {
  const x = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

const Slice = memo(function Slice({
  source,
  width,
  height,
  top,
  sliceHeight,
  shift,
  burst,
}: {
  source: ImageSourcePropType;
  width: number;
  height: number;
  top: number;
  sliceHeight: number;
  shift: number;
  burst: SharedValue<number>;
}) {
  const style = useAnimatedStyle(() => ({
    opacity: Math.abs(burst.value) > 0.05 ? 1 : 0,
    transform: [{ translateX: shift * burst.value }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', left: 0, top, width, height: sliceHeight, overflow: 'hidden' }, style]}
    >
      <Animated.Image
        source={source}
        resizeMode="contain"
        style={{ position: 'absolute', left: 0, top: -top, width, height }}
      />
    </Animated.View>
  );
});

/** A silhouette-shaped band of the sprite, tinted holo, drifting down her body. */
const ScanBand = memo(function ScanBand({
  source,
  width,
  height,
  clock,
  offset,
  bandHeight,
  opacity,
  speed,
}: {
  source: ImageSourcePropType;
  width: number;
  height: number;
  clock: SharedValue<number>;
  offset: number;
  bandHeight: number;
  opacity: number;
  speed: number;
}) {
  const travel = height + bandHeight;
  const outer = useAnimatedStyle(() => {
    const p = (clock.value * speed + offset) % 1;
    return { transform: [{ translateY: p * travel - bandHeight }] };
  });
  const inner = useAnimatedStyle(() => {
    const p = (clock.value * speed + offset) % 1;
    return { transform: [{ translateY: -(p * travel - bandHeight) }] };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: 'absolute', left: 0, top: 0, width, height: bandHeight, overflow: 'hidden', opacity },
        outer,
      ]}
    >
      <Animated.Image
        source={source}
        resizeMode="contain"
        style={[{ position: 'absolute', left: 0, top: 0, width, height, tintColor: HUD.holo }, inner]}
      />
    </Animated.View>
  );
});

/** Short horizontal data line that flickers in and out beside her silhouette. */
const Streak = memo(function Streak({
  clock,
  left,
  top,
  length,
  freq,
  phase,
  color,
}: {
  clock: SharedValue<number>;
  left: number;
  top: number;
  length: number;
  freq: number;
  phase: number;
  color: string;
}) {
  const dir = phase > 0.5 ? 1 : -1;
  const style = useAnimatedStyle(() => {
    const w = Math.sin(2 * Math.PI * (clock.value * freq + phase));
    // Mostly off, with brief on-pulses.
    const on = w > 0.55 ? (w - 0.55) / 0.45 : 0;
    return {
      opacity: on * 0.8,
      transform: [{ translateX: (1 - on) * 14 * dir }, { scaleX: 0.4 + on * 0.6 }],
    };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', left, top, width: length, height: 1.5, backgroundColor: color }, style]}
    />
  );
});

/** Hologram sprite: ambient scan lines + data streaks, and an RGB-split / slice glitch whenever `seed` changes. */
export const GlitchSprite = memo(function GlitchSprite({
  source,
  seed,
  width,
  height,
  ambient = true,
  paused = false,
}: GlitchSpriteProps) {
  const reduceMotion = useReducedMotion();
  const jitter = useSharedValue(0); // horizontal shake in px
  const split = useSharedValue(0); // RGB ghost intensity 0..1
  const burst = useSharedValue(0); // slice displacement 0..1
  const flicker = useSharedValue(1); // base opacity
  const isFirst = useRef(true);
  const clock = useSharedValue(0); // ambient loop 0..1
  const idleBurst = useSharedValue(0); // idle micro-glitch displacement
  const edge = useSharedValue(0.18); // holo fringe intensity
  const idleSplit = useSharedValue(0); // idle RGB ghost intensity
  const [idleSeed, setIdleSeed] = useState(1);
  const ambientOn = ambient && !reduceMotion;
  // The layers stay mounted while paused; only the loops stop.
  const looping = ambientOn && !paused;

  // Ambient hologram loop.
  useEffect(() => {
    if (!looping) return;
    // Resume where the loop left off so un-pausing doesn't make the scan lines jump.
    const from = clock.value % 1;
    clock.value = from;
    clock.value = withSequence(
      withTiming(1, { duration: CLOCK_MS * (1 - from), easing: Easing.linear }),
      withTiming(0, { duration: 0 }),
      withRepeat(withTiming(1, { duration: CLOCK_MS, easing: Easing.linear }), -1, false)
    );
    edge.value = withRepeat(
      withSequence(withTiming(0.32, { duration: 1400 }), withTiming(0.14, { duration: 1700 })),
      -1,
      false
    );
    return () => {
      cancelAnimation(clock);
      cancelAnimation(edge);
    };
  }, [looping, clock, edge]);

  // Occasional small glitch while idle, at random intervals.
  useEffect(() => {
    if (!looping) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        setIdleSeed((n) => n + 1);
        const t = (ms: number) => ({ duration: ms, easing: Easing.linear });
        idleBurst.value = withSequence(withTiming(1, t(20)), withTiming(-0.5, t(50)), withTiming(0, t(40)));
        idleSplit.value = withSequence(withTiming(0.35, t(20)), withTiming(0, t(140)));
        schedule();
      }, 2200 + Math.random() * 3800);
    };
    schedule();
    return () => clearTimeout(timer);
  }, [looping, idleBurst, idleSplit]);

  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }

    if (reduceMotion) {
      flicker.value = withSequence(withTiming(0.4, { duration: 80 }), withTiming(1, { duration: 200 }));
      return;
    }

    const t = (ms: number) => ({ duration: ms, easing: Easing.linear });
    jitter.value = withSequence(
      withTiming(-9, t(40)),
      withTiming(7, t(40)),
      withTiming(-4, t(40)),
      withTiming(5, t(40)),
      withTiming(-2, t(40)),
      withTiming(0, t(60))
    );
    split.value = withSequence(
      withTiming(1, t(30)),
      withDelay(170, withTiming(0.4, t(50))),
      withTiming(0, { duration: 120, easing: Easing.out(Easing.quad) })
    );
    burst.value = withSequence(
      withTiming(1, t(20)),
      withTiming(-0.6, t(60)),
      withTiming(0.8, t(50)),
      withTiming(0, t(40)),
      withDelay(60, withTiming(0.5, t(20))),
      withTiming(0, t(60))
    );
    flicker.value = withSequence(
      withTiming(0.35, t(30)),
      withTiming(1, t(40)),
      withTiming(0.6, t(30)),
      withTiming(1, t(80))
    );
  }, [seed, reduceMotion, jitter, split, burst, flicker]);

  const baseStyle = useAnimatedStyle(() => ({
    opacity: flicker.value,
    transform: [{ translateX: jitter.value * 0.4 }],
  }));
  const cyanStyle = useAnimatedStyle(() => ({
    opacity: Math.max(split.value, idleSplit.value) * 0.55,
    transform: [{ translateX: -6 * Math.max(split.value, idleSplit.value) - jitter.value }],
  }));
  const crimsonStyle = useAnimatedStyle(() => ({
    opacity: Math.max(split.value, idleSplit.value) * 0.5,
    transform: [{ translateX: 6 * Math.max(split.value, idleSplit.value) + jitter.value }],
  }));
  const edgeStyle = useAnimatedStyle(() => ({
    opacity: edge.value,
    transform: [{ translateX: -2 - jitter.value * 0.5 }],
  }));

  // Memoized so the memo'd layers below only re-render when their own layout changes.
  const slices = useMemo(() => Array.from({ length: SLICE_COUNT }).map((_, i) => {
    // Bias slices toward the upper body where the viewer is looking.
    const top = height * (0.08 + rand(seed, i) * 0.45);
    const sliceHeight = 6 + rand(seed, i + 10) * 26;
    const dir = rand(seed, i + 20) > 0.5 ? 1 : -1;
    const shift = dir * (10 + rand(seed, i + 30) * 26);
    return { top, sliceHeight, shift };
  }), [seed, height]);

  const idleSlices = useMemo(() => [0, 1].map((i) => {
    const top = height * (0.1 + rand(idleSeed, i + 40) * 0.5);
    const sliceHeight = 3 + rand(idleSeed, i + 50) * 12;
    const shift = (rand(idleSeed, i + 60) > 0.5 ? 1 : -1) * (6 + rand(idleSeed, i + 70) * 14);
    return { top, sliceHeight, shift };
  }), [idleSeed, height]);

  // Data streaks hug the sides of her silhouette (she sits roughly in the middle of the frame).
  const streaks = useMemo(() => Array.from({ length: STREAKS }).map((_, i) => {
    const side = i % 2 === 0 ? -1 : 1;
    const length = 14 + rand(i, 3) * 46;
    const cx = width / 2 + side * width * (0.2 + rand(i, 1) * 0.14);
    return {
      left: side < 0 ? cx - length : cx,
      top: height * (0.12 + rand(i, 2) * 0.5),
      length,
      freq: 1 + Math.floor(rand(i, 4) * 4),
      phase: rand(i, 5),
      color: i % 5 === 4 ? HUD.crimson : HUD.holo,
    };
  }), [width, height]);

  const imgStyle = { position: 'absolute' as const, left: 0, top: 0, width, height };

  return (
    <View pointerEvents="none" style={{ width, height }}>
      <Animated.Image
        source={source}
        resizeMode="contain"
        style={[imgStyle, { tintColor: HUD.holo }, cyanStyle]}
      />
      <Animated.Image
        source={source}
        resizeMode="contain"
        style={[imgStyle, { tintColor: HUD.crimson }, crimsonStyle]}
      />
      {ambient && (
        <Animated.Image source={source} resizeMode="contain" style={[imgStyle, { tintColor: HUD.holo }, edgeStyle]} />
      )}
      <Animated.Image source={source} resizeMode="contain" style={[imgStyle, baseStyle]} />
      {ambientOn && (
        <>
          {Array.from({ length: SCAN_BANDS }).map((_, i) => (
            <ScanBand
              key={`scan-${i}`}
              source={source}
              width={width}
              height={height}
              clock={clock}
              offset={i / SCAN_BANDS}
              bandHeight={1.5}
              opacity={0.45}
              speed={1}
            />
          ))}
          <ScanBand
            source={source}
            width={width}
            height={height}
            clock={clock}
            offset={0}
            bandHeight={34}
            opacity={0.22}
            speed={2}
          />
          {idleSlices.map((s, i) => (
            <Slice
              key={`idle-${i}`}
              source={source}
              width={width}
              height={height}
              top={s.top}
              sliceHeight={s.sliceHeight}
              shift={s.shift}
              burst={idleBurst}
            />
          ))}
          {streaks.map((s, i) => (
            <Streak key={`streak-${i}`} clock={clock} {...s} />
          ))}
        </>
      )}
      {!reduceMotion &&
        slices.map((s, i) => (
          <Slice
            key={i}
            source={source}
            width={width}
            height={height}
            top={s.top}
            sliceHeight={s.sliceHeight}
            shift={s.shift}
            burst={burst}
          />
        ))}
    </View>
  );
});
