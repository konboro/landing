import React from 'react';
import { Text } from 'react-native';
import { Tabs } from 'expo-router';
import { c, font } from '../../lib/theme';

function Icon({ emoji, color }: { emoji: string; color: string }) {
  return <Text style={{ fontSize: 22, color, opacity: color === c.primary ? 1 : 0.9 }}>{emoji}</Text>;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: c.surface },
        headerTintColor: c.text,
        headerTitleStyle: { fontWeight: '700' },
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border, height: 64, paddingBottom: 8, paddingTop: 6 },
        tabBarActiveTintColor: c.primary,
        tabBarInactiveTintColor: c.textMuted,
        tabBarLabelStyle: { fontSize: font.size.xs, fontWeight: '700' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Map', tabBarIcon: ({ color }) => <Icon emoji="🗺️" color={color} /> }}
      />
      <Tabs.Screen
        name="tasks"
        options={{ title: 'Tasks', tabBarIcon: ({ color }) => <Icon emoji="✅" color={color} /> }}
      />
      <Tabs.Screen
        name="myday"
        options={{ title: 'My day', tabBarIcon: ({ color }) => <Icon emoji="🧭" color={color} /> }}
      />
      <Tabs.Screen
        name="scan"
        options={{ title: 'Scan', tabBarIcon: ({ color }) => <Icon emoji="🔦" color={color} /> }}
      />
      <Tabs.Screen
        name="more"
        options={{ title: 'More', tabBarIcon: ({ color }) => <Icon emoji="⋯" color={color} /> }}
      />
    </Tabs>
  );
}
