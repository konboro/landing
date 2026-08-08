import type { ExpoConfig, ConfigContext } from 'expo/config';
import { resolveBuildBrand } from './src/brand/build';

/**
 * Penny Rider — Expo app config.
 *
 * WHITE-LABEL: everything client-specific (app name, slug, deep-link scheme,
 * bundle identifiers, splash/icon background, permission copy) is derived from
 * the brand selected by `EXPO_PUBLIC_BRAND`. Unset → the Penny defaults.
 *
 *     EXPO_PUBLIC_BRAND=meltemi npx expo run:ios
 *
 * The table lives in `src/brand/build.ts`, which the runtime brand registry
 * (`src/brand/brands.ts`) reuses — so the native build and the in-app theme can
 * never disagree about who this app belongs to.
 *
 * The Mapbox download token + public token are read from env so the app runs
 * WITHOUT native Mapbox in Expo Go (mock mode). When EXPO_PUBLIC_MAPBOX_TOKEN
 * is unset, <FleetMap> renders its graceful fallback instead of the native map.
 */
const brand = resolveBuildBrand(process.env.EXPO_PUBLIC_BRAND);

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: brand.name,
  slug: brand.slug,
  scheme: brand.scheme,
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  newArchEnabled: true,
  // Store assets are still real files per app — swap apps/rider/assets/* for a
  // client build (see the README's "Ship for a new client").
  icon: './assets/icon.png',
  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
    backgroundColor: brand.primary,
  },
  assetBundlePatterns: ['**/*'],
  ios: {
    bundleIdentifier: brand.iosBundleId,
    supportsTablet: false,
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        `${brand.name} uses your location to show nearby scooters and confirm parking.`,
      NSCameraUsageDescription:
        `${brand.name} uses the camera to scan QR codes and take the required end-of-ride parking photo.`,
      UIBackgroundModes: ['location'],
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: brand.androidPackage,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: brand.primary,
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
          `${brand.name} needs the camera to scan scooter QR codes and take your parking photo.`,
      },
    ],
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          `${brand.name} uses your location to show nearby scooters and validate parking zones.`,
      },
    ],
    [
      'expo-notifications',
      {
        color: brand.primary,
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
    // Kept off so router hrefs stay plain strings — enable once you've run the
    // app once to generate .expo/types (typed routes then validate every href).
    typedRoutes: false,
  },
  extra: {
    dataSource: process.env.EXPO_PUBLIC_DATA_SOURCE ?? 'mock',
    // Echoed so the running app can log which brand it was built for.
    brand: brand.id,
    router: {
      // routes live in src/app — auto-detected by expo-router.
    },
    eas: {
      projectId: '00000000-0000-0000-0000-000000000000',
    },
  },
});
