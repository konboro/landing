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

/* --------------------------------- Storage ---------------------------------- */

type AsyncStorageMod = { default: {
  getItem(k: string): Promise<string | null>;
  setItem(k: string, v: string): Promise<void>;
  removeItem(k: string): Promise<void>;
} };

/**
 * Small key/value persistence. Guarded like every other native module, so it is
 * a silent no-op in environments without AsyncStorage (web preview, tests).
 * Used for the manual theme-mode / brand override.
 */
export const Storage = {
  available(): boolean {
    return !!opt<AsyncStorageMod>(() => require('@react-native-async-storage/async-storage'));
  },
  async get(key: string): Promise<string | null> {
    const mod = opt<AsyncStorageMod>(() => require('@react-native-async-storage/async-storage'));
    if (!mod) return null;
    try {
      return await mod.default.getItem(key);
    } catch {
      return null;
    }
  },
  async set(key: string, value: string): Promise<void> {
    const mod = opt<AsyncStorageMod>(() => require('@react-native-async-storage/async-storage'));
    if (!mod) return;
    try {
      await mod.default.setItem(key, value);
    } catch {
      /* ignore */
    }
  },
  async remove(key: string): Promise<void> {
    const mod = opt<AsyncStorageMod>(() => require('@react-native-async-storage/async-storage'));
    if (!mod) return;
    try {
      await mod.default.removeItem(key);
    } catch {
      /* ignore */
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
  /**
   * The Expo push token for this device, or null when push is unavailable
   * (Expo Go without a project id, simulator, permission denied).
   *
   * The token is what `admin-broadcast` sends to; without a row in
   * `push_tokens` a rider simply is not reachable by push, which is why the
   * panel reports "0 registered devices" rather than pretending it delivered.
   */
  async getPushToken(): Promise<{ token: string; platform: string } | null> {
    const mod = opt<NotifMod>(() => require('expo-notifications'));
    if (!mod) return null;
    try {
      const perm = await mod.getPermissionsAsync();
      if (!perm.granted) return null;
      const constants = opt<typeof import('expo-constants')>(() => require('expo-constants'))?.default;
      const projectId =
        constants?.expoConfig?.extra?.eas?.projectId ?? constants?.easConfig?.projectId;
      const res = await mod.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
      if (!res?.data) return null;
      return { token: res.data, platform: Platform.OS };
    } catch {
      // A missing/placeholder EAS project id throws here — not fatal, the app
      // just stays push-less.
      return null;
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

/* ---------------------------------- Stripe ---------------------------------- */

type StripeMod = typeof import('@stripe/stripe-react-native');

/**
 * PaymentSheet access, guarded like every other native module here.
 *
 * Two things have to be true before a sheet can open: the native module has to
 * exist (it does not in Expo Go) and a publishable key has to be configured.
 * `available()` reports both together, so callers can hide payment UI instead of
 * letting a tap fail — mock mode keeps working untouched.
 *
 * `initStripe` is called once and memoised. Calling it per sheet is not harmful
 * but is a native round-trip on every card add.
 */
let stripeInit: Promise<boolean> | null = null;

export const StripeSvc = {
  publishableKey(): string | undefined {
    const k = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    return k && k.length > 0 ? k : undefined;
  },

  available(): boolean {
    if (!this.publishableKey()) return false;
    return !!opt<StripeMod>(() => require('@stripe/stripe-react-native'));
  },

  async init(): Promise<boolean> {
    if (stripeInit) return stripeInit;
    stripeInit = (async () => {
      const key = this.publishableKey();
      const mod = opt<StripeMod>(() => require('@stripe/stripe-react-native'));
      if (!key || !mod) return false;
      try {
        await mod.initStripe({ publishableKey: key });
        return true;
      } catch {
        return false;
      }
    })();
    return stripeInit;
  },

  /**
   * Present PaymentSheet for either a SetupIntent (adding a card) or a
   * PaymentIntent (taking money). Resolves 'canceled' when the rider dismisses
   * the sheet — that is a normal outcome, not an error, and callers should not
   * surface it as a failure. Anything genuinely wrong throws.
   */
  async presentSheet(opts: {
    /** 'setup' saves a card (SetupIntent); 'payment' takes money (PaymentIntent). */
    kind: 'setup' | 'payment';
    clientSecret: string;
    merchantDisplayName?: string;
  }): Promise<'completed' | 'canceled'> {
    const mod = opt<StripeMod>(() => require('@stripe/stripe-react-native'));
    if (!mod) throw new Error('Stripe is unavailable in this build.');
    if (!(await this.init())) throw new Error('Stripe is not configured.');

    // Needed so 3DS/redirect flows can return to the app. Read from the live
    // Expo config rather than hardcoded, because the scheme is white-label.
    const constants = opt<typeof import('expo-constants')>(() => require('expo-constants'))?.default;
    const rawScheme = constants?.expoConfig?.scheme;
    const scheme = Array.isArray(rawScheme) ? rawScheme[0] : rawScheme;

    // SetupParams is a discriminated union — exactly one of the intent secrets may
    // be present, so the two cases are built separately rather than with an
    // `undefined` sibling key.
    const common = {
      merchantDisplayName: opts.merchantDisplayName ?? 'Penny',
      allowsDelayedPaymentMethods: false,
      returnURL: scheme ? `${scheme}://stripe-redirect` : undefined,
    };
    const init = await mod.initPaymentSheet(
      opts.kind === 'setup'
        ? { ...common, setupIntentClientSecret: opts.clientSecret }
        : { ...common, paymentIntentClientSecret: opts.clientSecret },
    );
    if (init.error) throw new Error(init.error.message);

    const res = await mod.presentPaymentSheet();
    if (res.error) {
      if (res.error.code === 'Canceled') return 'canceled';
      throw new Error(res.error.message);
    }
    return 'completed';
  },
};

export const isNativeMap = Platform.OS !== 'web';
