import React from 'react';
import { Platform } from 'react-native';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../brand';
import { Icon, type IconName } from '../../components/ui/Icon';
import { useT } from '../../i18n';

export default function TabsLayout() {
  const { t } = useT();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  // The active tab reads heavier as well as bluer: at 22 px a colour change
  // alone is easy to miss, so the stroke thickens too.
  const icon = (name: IconName) =>
    ({ color, focused }: { color: string; focused: boolean }) => (
      <Icon name={name} size={24} color={color} strokeWidth={focused ? 2.1 : 1.6} />
    );

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.color.primary,
        tabBarInactiveTintColor: theme.color.tabInactive,
        tabBarStyle: {
          backgroundColor: theme.color.surface,
          // No hairline: the backdrop already fades into the bar, and the rule
          // cut across that gradient.
          borderTopWidth: 0,
          height: 62 + insets.bottom,
          paddingBottom: insets.bottom > 0 ? insets.bottom : 10,
          paddingTop: 10,
          // Lifts the bar off the sky rather than letting it sit flat on it.
          shadowColor: theme.palette.ink900,
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: 0.06,
          shadowRadius: 14,
          elevation: 12,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          letterSpacing: 0.1,
          // Android centres labels tighter than iOS; this evens them out.
          marginTop: Platform.OS === 'android' ? 2 : 0,
        },
        tabBarItemStyle: { paddingTop: 2 },
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
