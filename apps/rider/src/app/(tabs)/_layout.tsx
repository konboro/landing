import React from 'react';
import { Tabs } from 'expo-router';
import { useTheme } from '../../brand';
import { Icon, type IconName } from '../../components/ui/Icon';
import { useT } from '../../i18n';

export default function TabsLayout() {
  const { t } = useT();
  const theme = useTheme();
  const icon = (name: IconName) => ({ color, size }: { color: string; size: number }) =>
    <Icon name={name} size={size ?? 22} color={color} />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.color.primary,
        tabBarInactiveTintColor: theme.color.tabInactive,
        tabBarStyle: {
          backgroundColor: theme.color.surface,
          borderTopColor: theme.color.border,
          height: 62,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="map" options={{ title: t('tabs.map'), tabBarIcon: icon('map') }} />
      <Tabs.Screen name="wallet" options={{ title: t('tabs.wallet'), tabBarIcon: icon('wallet') }} />
      <Tabs.Screen name="history" options={{ title: t('tabs.history'), tabBarIcon: icon('history') }} />
      <Tabs.Screen name="profile" options={{ title: t('tabs.profile'), tabBarIcon: icon('profile') }} />
      <Tabs.Screen name="support" options={{ title: t('tabs.support'), tabBarIcon: icon('help') }} />
    </Tabs>
  );
}
