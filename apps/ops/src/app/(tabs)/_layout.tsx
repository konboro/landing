import React from 'react';
import { Platform } from 'react-native';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../brand';
import { Icon, type IconName } from '../../components/ui';

/**
 * Ops bottom bar.
 *
 * Same construction as the rider app's: vector glyphs instead of emoji (emoji
 * render differently per OEM font and cannot take a tint), the safe-area inset
 * folded into the height rather than left to the OS, and a lift shadow so the
 * bar reads as floating above a full-bleed map instead of sitting on it.
 *
 * Tab order is declaration order and `index` sits dead centre on purpose: the
 * fleet is the screen a crew returns to between every job, and the middle slot
 * is the easiest to hit one-handed while holding a scooter with the other.
 */
export default function TabsLayout() {
  const { c, font } = useTheme();
  const insets = useSafeAreaInsets();

  // The active tab reads heavier as well as brighter — at a glance in daylight
  // a colour change alone is easy to miss, so the stroke thickens too.
  const icon = (name: IconName) =>
    ({ color, focused }: { color: string; focused: boolean }) => (
      <Icon name={name} size={24} color={color} strokeWidth={focused ? 2.3 : 1.7} />
    );

  return (
    <Tabs
      initialRouteName="index"
      screenOptions={{
        headerStyle: { backgroundColor: c.surface },
        headerTintColor: c.text,
        headerTitleStyle: { fontWeight: '700' },
        tabBarActiveTintColor: c.primary,
        tabBarInactiveTintColor: c.textMuted,
        tabBarStyle: {
          backgroundColor: c.surface,
          borderTopWidth: 0,
          height: 62 + insets.bottom,
          paddingBottom: insets.bottom > 0 ? insets.bottom : 10,
          paddingTop: 10,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: 0.18,
          shadowRadius: 14,
          elevation: 12,
        },
        tabBarLabelStyle: {
          fontSize: font.size.xs,
          fontWeight: '700',
          letterSpacing: 0.1,
          // Android centres labels tighter than iOS; this evens them out.
          marginTop: Platform.OS === 'android' ? 2 : 0,
        },
        tabBarItemStyle: { paddingTop: 2 },
      }}
    >
      <Tabs.Screen name="tasks" options={{ title: 'Tasks', tabBarIcon: icon('check') }} />
      {/* No header: the map is full-bleed and the Place/Heatmap segmented
          control lives in the strip a header would otherwise take. */}
      <Tabs.Screen name="place" options={{ title: 'Place', headerShown: false, tabBarIcon: icon('place') }} />
      <Tabs.Screen name="index" options={{ title: 'Fleet', tabBarIcon: icon('scooter') }} />
      <Tabs.Screen name="scan" options={{ title: 'Scan', tabBarIcon: icon('qr') }} />
      <Tabs.Screen name="myday" options={{ title: 'My day', tabBarIcon: icon('shift') }} />
      {/* Reachable from My day rather than owning a slot of its own — it is a
          settings drawer, not a place the crew works. */}
      <Tabs.Screen name="more" options={{ href: null }} />
    </Tabs>
  );
}
