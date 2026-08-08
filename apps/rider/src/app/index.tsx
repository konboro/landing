import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Redirect } from 'expo-router';
import { useBrand, useTheme, makeStyles } from '../brand';
import { T } from '../components/ui';
import { useSession, needsOnboarding } from '../store/session';

export default function Index() {
  const { ready, user, onboarding } = useSession();
  const { brand } = useBrand();
  const theme = useTheme();
  const styles = useStyles(theme);

  if (!ready) {
    return (
      <View style={styles.splash}>
        <View style={styles.monogram}>
          <T variant="title" color={theme.color.primary}>{brand.assets.monogram}</T>
        </View>
        <T variant="display" color={theme.color.onPrimary} style={{ marginTop: theme.space.lg }}>
          {brand.name}
        </T>
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

const useStyles = makeStyles((t) => ({
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.color.primary,
  },
  monogram: {
    width: 72,
    height: 72,
    borderRadius: t.radius.xl,
    backgroundColor: t.color.onPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
