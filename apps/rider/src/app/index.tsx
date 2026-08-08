import React from 'react';
import { View, ActivityIndicator, Image, StyleSheet } from 'react-native';
import { Redirect } from 'expo-router';
import { theme } from '../lib/theme';
import { T } from '../components/ui';
import { useSession, needsOnboarding } from '../store/session';

export default function Index() {
  const { ready, user, onboarding } = useSession();

  if (!ready) {
    return (
      <View style={styles.splash}>
        <T variant="display" color={theme.color.onPrimary}>Penny</T>
        <T variant="body" color={theme.color.onPrimary} style={{ opacity: 0.85, marginTop: 4 }}>
          Unlock a scooter. Go anywhere.
        </T>
        <ActivityIndicator color={theme.color.onPrimary} style={{ marginTop: 24 }} />
      </View>
    );
  }

  if (!user || needsOnboarding(onboarding)) {
    return <Redirect href="/onboarding" />;
  }
  return <Redirect href="/(tabs)/map" />;
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.color.primary,
  },
});
