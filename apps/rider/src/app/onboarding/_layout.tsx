import React from 'react';
import { Stack } from 'expo-router';
import { theme } from '../../lib/theme';

export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.color.bg },
        animation: 'slide_from_right',
      }}
    />
  );
}
