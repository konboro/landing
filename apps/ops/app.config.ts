import type { ExpoConfig } from 'expo/config';
import { resolveBuildBrand } from './src/brand/build';

/**
 * Penny Ops — field service app.
 *
 * WHITE-LABEL: app name, slug, deep-link scheme, bundle identifiers, splash /
 * adaptive-icon background and permission copy are all derived from the brand
 * selected by `EXPO_PUBLIC_BRAND`. Unset → the Penny defaults.
 *
 *     EXPO_PUBLIC_BRAND=nordvei pnpm --filter @penny/ops start
 *
 * The table lives in `src/brand/build.ts`, which the runtime brand registry
 * (`src/brand/brands.ts`) reuses, so the native build and the in-app theme can
 * never disagree. Bundle id + scheme stay distinct from the rider app's.
 *
 * Mapbox download token is read from env at build time; the app renders a
 * graceful fallback (styled list) when no public token is present, so it also
 * runs in Expo Go.
 */
const brand = resolveBuildBrand(process.env.EXPO_PUBLIC_BRAND);
const MAPBOX_DOWNLOAD_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '';

const config: ExpoConfig = {
  name: brand.opsName,
  slug: brand.slug,
  scheme: brand.scheme,
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  // Store assets are still real files — swap apps/ops/assets/* for a client build.
  icon: './assets/icon.png',
  splash: {
    resizeMode: 'contain',
    backgroundColor: brand.splash,
  },
  assetBundlePatterns: ['**/*'],
  ios: {
    bundleIdentifier: brand.iosBundleId,
    supportsTablet: true,
    infoPlist: {
      NSCameraUsageDescription:
        `${brand.opsName} uses the camera to attach photos to tasks, damage reports and status changes.`,
      NSLocationWhenInUseUsageDescription:
        `${brand.opsName} uses your location to order your route, drop deployed vehicles and geotag actions.`,
      UIBackgroundModes: ['location', 'fetch'],
    },
  },
  android: {
    package: brand.androidPackage,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: brand.splash,
    },
    permissions: [
      'CAMERA',
      'ACCESS_FINE_LOCATION',
      'ACCESS_COARSE_LOCATION',
      'INTERNET',
      'ACCESS_NETWORK_STATE',
    ],
  },
  plugins: [
    'expo-router',
    ['expo-camera', { cameraPermission: `Allow ${brand.opsName} to attach photos to field actions.` }],
    'expo-sqlite',
    [
      'expo-location',
      { locationWhenInUsePermission: `Allow ${brand.opsName} to use your location for routing and geotagging.` },
    ],
    [
      '@rnmapbox/maps',
      {
        // Native builds need a download token; graceful fallback covers Expo Go.
        RNMapboxMapsDownloadToken: MAPBOX_DOWNLOAD_TOKEN || 'PLACEHOLDER_SET_EXPO_PUBLIC_MAPBOX_TOKEN',
      },
    ],
  ],
  experiments: {
    // Kept off so plain string hrefs (e.g. `/vehicle/${id}`) type-check without
    // the generated .expo/types. Flip on once routes are generated if desired.
    typedRoutes: false,
  },
  extra: {
    dataSource: process.env.EXPO_PUBLIC_DATA_SOURCE ?? 'mock',
    mapboxToken: process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '',
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
    // Echoed so the running app can log which brand it was built for.
    brand: brand.id,
  },
};

export default config;
