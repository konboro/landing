import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useOps } from '../lib/store';
import { loadSession } from '../lib/auth';
import { startSync } from '../offline/sync';
import { isSeeded } from '../offline/repo';
import { getOpsApi } from '../services';
import { seedFromBootstrap } from '../offline/repo';
import { BrandProvider, useBrand, useTheme, makeStyles } from '../brand';

export default function RootLayout() {
  return (
    <BrandProvider>
      <AppShell />
    </BrandProvider>
  );
}

function AppShell() {
  const [booting, setBooting] = useState(true);
  const setSession = useOps((s) => s.setSession);
  const setBootstrapped = useOps((s) => s.setBootstrapped);
  const theme = useTheme();
  const styles = useStyles(theme);
  const { opsName } = useBrand();
  const { c } = theme;

  useEffect(() => {
    (async () => {
      try {
        const session = await loadSession();
        if (session) {
          setSession(session);
          if (!(await isSeeded())) {
            const snap = await getOpsApi().getBootstrap(session);
            await seedFromBootstrap(snap);
          }
          setBootstrapped(true);
          startSync();
        }
      } catch {
        /* first launch / no sqlite — fall through to login */
      } finally {
        setBooting(false);
      }
    })();
  }, [setSession, setBootstrapped]);

  if (booting) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator color={c.primary} size="large" />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style={theme.mode === 'dark' ? 'light' : 'dark'} />
        <AuthGate />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: c.surface },
            headerTintColor: c.text,
            headerTitleStyle: { fontWeight: '700' },
            contentStyle: { backgroundColor: c.bg },
          }}
        >
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="onboarding" options={{ title: `Welcome to ${opsName}`, headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="dev" options={{ title: 'Sync & Dev tools', presentation: 'modal' }} />
          <Stack.Screen name="deploy" options={{ title: 'Deploy mode' }} />
          <Stack.Screen name="task/[id]" options={{ title: 'Task' }} />
          <Stack.Screen name="vehicle/[id]/index" options={{ title: 'Vehicle' }} />
          <Stack.Screen name="vehicle/[id]/status" options={{ title: 'Change status', presentation: 'modal' }} />
          <Stack.Screen name="vehicle/[id]/swap-device" options={{ title: 'Swap device' }} />
          {/* These four render their own headers (full-bleed map, chat thread,
              inverted note list), so the stack must not draw a second one. */}
          <Stack.Screen name="chat" options={{ headerShown: false }} />
          <Stack.Screen name="vehicle/[id]/notes" options={{ headerShown: false }} />
          <Stack.Screen name="vehicle/[id]/last-ride" options={{ headerShown: false }} />
          <Stack.Screen name="vehicle/[id]/history" options={{ title: 'History' }} />
          <Stack.Screen name="damage/new" options={{ title: 'New damage report', presentation: 'modal' }} />
          <Stack.Screen name="damage/index" options={{ title: 'Damage reports' }} />
          <Stack.Screen name="damage/[id]" options={{ title: 'Damage report' }} />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

// Redirect logic: unauthenticated -> /login; authenticated on auth screens -> tabs.
function AuthGate() {
  const router = useRouter();
  const segments = useSegments();
  const session = useOps((s) => s.session);

  useEffect(() => {
    const seg0 = segments[0];
    const onAuthScreen = seg0 === 'login' || seg0 === undefined || seg0 === 'index' || seg0 === 'onboarding';
    if (!session && !(seg0 === 'login' || seg0 === 'onboarding')) {
      router.replace('/login');
    } else if (session && onAuthScreen && seg0 !== 'onboarding') {
      router.replace('/(tabs)');
    }
  }, [session, segments, router]);

  return null;
}

const useStyles = makeStyles((t) => ({
  boot: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.c.bg },
}));
