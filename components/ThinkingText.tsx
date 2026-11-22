import React, { useEffect, useState } from 'react';
import { Text, TextProps } from 'react-native';

const FRAMES = ['', '.', '..', '...'];

/** "Thinking" with cycling dots — shown while the model hasn't produced any text yet. */
export function ThinkingText({ label = 'Thinking', ...textProps }: TextProps & { label?: string }) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), 380);
    return () => clearInterval(id);
  }, []);

  return (
    <Text accessibilityLabel={`${label}…`} {...textProps}>
      {label}
      {/* Fixed-width tail so the dots don't make the text jump. */}
      <Text>{FRAMES[frame]}</Text>
      <Text style={{ opacity: 0 }}>{'...'.slice(FRAMES[frame].length)}</Text>
    </Text>
  );
}
