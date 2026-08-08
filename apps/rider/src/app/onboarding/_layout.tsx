import React from 'react';
import { Stack } from 'expo-router';
import { useTheme } from '../../brand';

export default function OnboardingLayout() {
  const theme = useTheme();
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
