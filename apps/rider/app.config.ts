import type { ExpoConfig, ConfigContext } from 'expo/config';

/**
 * Penny Rider — Expo app config.
 *
 * The Mapbox download token + public token are read from env so the app runs
 * WITHOUT native Mapbox in Expo Go (mock mode). When EXPO_PUBLIC_MAPBOX_TOKEN
 * is unset, <FleetMap> renders its graceful fallback instead of the native map.
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Penny',
  slug: 'penny-rider',
  scheme: 'penny',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  newArchEnabled: true,
  icon: './assets/icon.png',
  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#2f5be0',
  },
  assetBundlePatterns: ['**/*'],
  ios: {
    bundleIdentifier: 'com.pennyrent.rider',
    supportsTablet: false,
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        'Penny uses your location to show nearby scooters and confirm parking.',
      NSCameraUsageDescription:
        'Penny uses the camera to scan QR codes and take the required end-of-ride parking photo.',
      UIBackgroundModes: ['location'],
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: 'com.pennyrent.rider',
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#2f5be0',
    },
    permissions: [
      'ACCESS_FINE_LOCATION',
      'ACCESS_COARSE_LOCATION',
      'CAMERA',
      'VIBRATE',
    ],
  },
  web: {
    bundler: 'metro',
    output: 'single',
  },
  plugins: [
    'expo-router',
    'expo-localization',
    [
      'expo-camera',
      {
        cameraPermission:
          'Penny needs the camera to scan scooter QR codes and take your parking photo.',
      },
    ],
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'Penny uses your location to show nearby scooters and validate parking zones.',
      },
    ],
    [
      'expo-notifications',
      {
        color: '#2f5be0',
      },
    ],
    [
      '@rnmapbox/maps',
      {
        // Placeholder — replace with your real Mapbox downloads token before a native build.
        RNMapboxMapsDownloadToken:
          process.env.MAPBOX_DOWNLOAD_TOKEN ?? 'sk.PLACEHOLDER_MAPBOX_DOWNLOAD_TOKEN',
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    dataSource: process.env.EXPO_PUBLIC_DATA_SOURCE ?? 'mock',
    router: {
      // routes live in src/app — auto-detected by expo-router.
    },
    eas: {
      projectId: '00000000-0000-0000-0000-000000000000',
    },
  },
});
