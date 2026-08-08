import type { ExpoConfig } from 'expo/config';

// Penny Ops — field service app. Bundle id + scheme distinct from rider.
// Mapbox download token is read from env at build time; the app renders a
// graceful fallback (styled list) when no public token is present, so it also
// runs in Expo Go for tomorrow's standalone demo.
const MAPBOX_DOWNLOAD_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '';

const config: ExpoConfig = {
  name: 'Penny Ops',
  slug: 'penny-ops',
  scheme: 'pennyops',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  icon: './assets/icon.png',
  splash: {
    resizeMode: 'contain',
    backgroundColor: '#111f52',
  },
  assetBundlePatterns: ['**/*'],
  ios: {
    bundleIdentifier: 'com.pennyrent.ops',
    supportsTablet: true,
    infoPlist: {
      NSCameraUsageDescription:
        'Penny Ops uses the camera to attach photos to tasks, damage reports and status changes.',
      NSLocationWhenInUseUsageDescription:
        'Penny Ops uses your location to order your route, drop deployed vehicles and geotag actions.',
      UIBackgroundModes: ['location', 'fetch'],
    },
  },
  android: {
    package: 'com.pennyrent.ops',
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#111f52',
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
    ['expo-camera', { cameraPermission: 'Allow Penny Ops to attach photos to field actions.' }],
    'expo-sqlite',
    [
      'expo-location',
      { locationWhenInUsePermission: 'Allow Penny Ops to use your location for routing and geotagging.' },
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
    typedRoutes: true,
  },
  extra: {
    dataSource: process.env.EXPO_PUBLIC_DATA_SOURCE ?? 'mock',
    mapboxToken: process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '',
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
  },
};

export default config;
