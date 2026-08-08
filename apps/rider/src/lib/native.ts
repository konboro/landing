// Guarded access to native modules. Everything here degrades gracefully so the
// app runs in Expo Go (mock mode) even when a native module is unavailable.
// We never import a native-only module at module top-level in a way that can
// crash bundle evaluation — each access is wrapped in try/catch.

import { Platform } from 'react-native';

function opt<T>(loader: () => T): T | null {
  try {
    return loader();
  } catch {
    return null;
  }
}

/* ---------------------------------- Haptics --------------------------------- */

type HapticsMod = typeof import('expo-haptics');
const haptics = opt<HapticsMod>(() => require('expo-haptics'));

export const Haptics = {
  light() {
    haptics?.impactAsync(haptics.ImpactFeedbackStyle.Light).catch(() => {});
  },
  medium() {
    haptics?.impactAsync(haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  },
  heavy() {
    haptics?.impactAsync(haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
  },
  success() {
    haptics?.notificationAsync(haptics.NotificationFeedbackType.Success).catch(() => {});
  },
  warning() {
    haptics?.notificationAsync(haptics.NotificationFeedbackType.Warning).catch(() => {});
  },
  error() {
    haptics?.notificationAsync(haptics.NotificationFeedbackType.Error).catch(() => {});
  },
  select() {
    haptics?.selectionAsync().catch(() => {});
  },
};

/* --------------------------------- Location --------------------------------- */

type LocationMod = typeof import('expo-location');

export type Coords = { lng: number; lat: number };

export const LocationSvc = {
  available(): boolean {
    return !!opt<LocationMod>(() => require('expo-location'));
  },
  async requestPermission(): Promise<'granted' | 'denied' | 'unavailable'> {
    const mod = opt<LocationMod>(() => require('expo-location'));
    if (!mod) return 'unavailable';
    try {
      const res = await mod.requestForegroundPermissionsAsync();
      return res.granted ? 'granted' : 'denied';
    } catch {
      return 'unavailable';
    }
  },
  async current(): Promise<Coords | null> {
    const mod = opt<LocationMod>(() => require('expo-location'));
    if (!mod) return null;
    try {
      const perm = await mod.getForegroundPermissionsAsync();
      if (!perm.granted) return null;
      const pos = await mod.getCurrentPositionAsync({ accuracy: mod.Accuracy.Balanced });
      return { lng: pos.coords.longitude, lat: pos.coords.latitude };
    } catch {
      return null;
    }
  },
};

/* ------------------------------- Notifications ------------------------------ */

type NotifMod = typeof import('expo-notifications');

export const Notifications = {
  available(): boolean {
    return !!opt<NotifMod>(() => require('expo-notifications'));
  },
  async requestPermission(): Promise<'granted' | 'denied' | 'unavailable'> {
    const mod = opt<NotifMod>(() => require('expo-notifications'));
    if (!mod) return 'unavailable';
    try {
      const res = await mod.requestPermissionsAsync();
      return res.granted ? 'granted' : 'denied';
    } catch {
      return 'unavailable';
    }
  },
  /** Local, immediate notification — stands in for server push in mock mode. */
  async notify(title: string, body: string): Promise<void> {
    const mod = opt<NotifMod>(() => require('expo-notifications'));
    if (!mod) return;
    try {
      await mod.scheduleNotificationAsync({ content: { title, body }, trigger: null });
    } catch {
      /* ignore */
    }
  },
};

export const isNativeMap = Platform.OS !== 'web';
