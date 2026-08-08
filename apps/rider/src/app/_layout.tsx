import 'react-native-gesture-handler';
import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { BrandProvider, useTheme } from '../brand';
import { useSession } from '../store/session';
import { useTrip } from '../store/trip';

export default function RootLayout() {
  return (
    <BrandProvider>
      <AppShell />
    </BrandProvider>
  );
}

function AppShell() {
  const theme = useTheme();
  const load = useSession((s) => s.load);
  const hydrateTrip = useTrip((s) => s.hydrate);

  useEffect(() => {
    load();
    hydrateTrip();
  }, [load, hydrateTrip]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style={theme.mode === 'dark' ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: theme.color.bg },
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="onboarding" />
          <Stack.Screen name="scan" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="unlock" options={{ presentation: 'fullScreenModal', gestureEnabled: false }} />
          <Stack.Screen name="vehicle/[code]" options={{ presentation: 'modal' }} />
          <Stack.Screen name="ride/index" options={{ gestureEnabled: false }} />
          <Stack.Screen name="ride/end" options={{ gestureEnabled: false }} />
          <Stack.Screen name="reaction-test" options={{ presentation: 'fullScreenModal' }} />
          <Stack.Screen name="parking-school" options={{ presentation: 'modal' }} />
          <Stack.Screen name="inbox" options={{ presentation: 'modal' }} />
          <Stack.Screen name="trip/[id]" options={{ presentation: 'card' }} />
          <Stack.Screen name="report/[code]" options={{ presentation: 'modal' }} />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
