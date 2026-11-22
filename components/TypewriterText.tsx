import React, { useEffect, useRef, useState } from 'react';
import { Text, TextProps } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

/**
 * A tiny observable string. The LLM writes into it on every token without causing any React
 * render; only the TypewriterText reading it re-renders, at its own steady pace.
 */
export interface TextSource {
  get(): string;
  set(next: string): void;
  subscribe(listener: () => void): () => void;
}

export function createTextSource(initial = ''): TextSource {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      if (next === value) return;
      value = next;
      listeners.forEach((l) => l());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function commonPrefixLength(a: string, b: string) {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

/** Base typing speed (characters per second) when she's caught up with the LLM. */
const BASE_CPS = 42;
/** Extra speed per character of backlog, so the text never trails the model by much. */
const CATCH_UP = 3;
/** Short pause after sentence punctuation, for a natural rhythm. */
const PUNCT_PAUSE_MS = 110;

type Props = Omit<TextProps, 'children'> & {
  /** Fixed text to type out. */
  text?: string;
  /** Live text that keeps growing (takes precedence over `text`). */
  source?: TextSource;
  /** Characters already visible on mount (hand-off from a streaming bubble). Defaults to 0. */
  startAt?: number;
  /** false = show everything immediately. */
  animate?: boolean;
  /** Keep the cursor on while more text is still expected. */
  streaming?: boolean;
  cursorColor?: string;
  /** Mirrors how many characters are on screen, for hand-off to another TypewriterText. */
  revealedRef?: React.MutableRefObject<number>;
  onDone?: () => void;
};

export function TypewriterText({
  text = '',
  source,
  startAt = 0,
  animate = true,
  streaming = false,
  cursorColor,
  revealedRef,
  onDone,
  style,
  ...textProps
}: Props) {
  const reducedMotion = useReducedMotion();
  const instant = !animate || reducedMotion;

  // What's on screen. Refs below drive the animation loop; render reads only this state.
  const [view, setView] = useState(() => {
    const initial = source ? source.get() : text;
    const at = instant ? initial.length : Math.min(startAt, initial.length);
    return { target: initial, at, visible: initial.slice(0, at), more: at < initial.length };
  });
  const targetRef = useRef<string | null>(null);
  const posRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    if (targetRef.current === null) {
      targetRef.current = view.target;
      posRef.current = view.at;
    }
    const setShown = (n: number) => {
      const target = targetRef.current ?? '';
      const more = n < target.length;
      // Bail out unless what's on screen changes, so tokens arriving ahead of the cursor cost nothing.
      setView((v) =>
        v.at === n && v.more === more && v.target.startsWith(v.visible) && target.startsWith(v.visible)
          ? v
          : { target, at: n, visible: target.slice(0, n), more }
      );
      if (revealedRef) revealedRef.current = n;
    };
    let last = 0;
    let pauseUntil = 0;
    let doneFired = posRef.current >= targetRef.current.length;

    const stop = () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };

    const tick = (now: number) => {
      const target = targetRef.current ?? '';
      const dt = last ? Math.min(now - last, 100) : 16;
      last = now;
      if (now >= pauseUntil) {
        const backlog = target.length - posRef.current;
        const prevInt = Math.floor(posRef.current);
        posRef.current = Math.min(target.length, posRef.current + ((BASE_CPS + backlog * CATCH_UP) * dt) / 1000);
        const nextInt = Math.floor(posRef.current);
        if (nextInt !== prevInt) {
          setShown(nextInt);
          // Breathe after a sentence, but not when far behind.
          if (backlog < 40 && /[.!?…]/.test(target[nextInt - 1] ?? '')) pauseUntil = now + PUNCT_PAUSE_MS;
        }
      }
      if (posRef.current < target.length) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        frameRef.current = null;
        last = 0;
        if (!doneFired) {
          doneFired = true;
          onDoneRef.current?.();
        }
      }
    };

    const onTarget = (next: string) => {
      const prev = targetRef.current ?? '';
      targetRef.current = next;
      // Streamed text can be rewritten (e.g. a NOTE line or *stage direction* gets hidden) —
      // never show more than what still matches.
      const keep = commonPrefixLength(prev, next);
      if (posRef.current > keep) posRef.current = keep;
      if (instant) {
        posRef.current = next.length;
        setShown(next.length);
        return;
      }
      setShown(Math.floor(posRef.current)); // no-op render unless it was cut back above
      if (posRef.current < next.length) {
        doneFired = false;
        if (frameRef.current == null) frameRef.current = requestAnimationFrame(tick);
      }
    };

    const unsubscribe = source?.subscribe(() => onTarget(source.get()));
    onTarget(source ? source.get() : text);
    return () => {
      unsubscribe?.();
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, text, instant]);

  const typing = !instant && (view.more || streaming);

  return (
    <Text {...textProps} style={style}>
      {view.visible}
      {typing && <Text style={{ color: cursorColor, opacity: 0.85 }}>▍</Text>}
    </Text>
  );
}
