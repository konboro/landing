import React from 'react';
import { View } from 'react-native';
import { theme } from '../../lib/theme';

const STEPS = ['phone', 'otp', 'name', 'consents', 'kyc', 'card', 'tutorial'] as const;

export function StepDots({ current }: { current: (typeof STEPS)[number] }) {
  const idx = STEPS.indexOf(current);
  return (
    <View style={{ flexDirection: 'row', gap: 6, justifyContent: 'center', paddingVertical: theme.space.md }}>
      {STEPS.map((s, i) => (
        <View
          key={s}
          style={{
            height: 6,
            width: i === idx ? 22 : 6,
            borderRadius: 3,
            backgroundColor: i <= idx ? theme.color.primary : theme.color.border,
          }}
        />
      ))}
    </View>
  );
}
