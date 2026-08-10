#!/usr/bin/env node
/**
 * Build a shareable release APK of the ops (field service) app.
 *
 *   pnpm --filter @penny/ops apk            # arm64 + armv7 (real phones)
 *   pnpm --filter @penny/ops apk -- --all   # + x86/x86_64 (emulators), ~2x size
 *
 * Two things this wraps, both of which cost an afternoon to rediscover:
 *
 * 1. EXPO_NO_METRO_WORKSPACE_ROOT=1. `createBundleReleaseJsAndAssets` otherwise
 *    dies with
 *
 *      Unable to resolve module ./../../node_modules/expo-router/entry.js
 *      from C:\dev\landing/.
 *
 *    The React Native Gradle plugin passes the entry **relative to the app
 *    directory** — with `node-linker=hoisted` (see .npmrc) expo-router lives in
 *    the repo root, so that argument is `..\..\node_modules\expo-router\entry.js`.
 *    Metro, meanwhile, defaults its server root to the *workspace* root, where
 *    those two levels up land outside the drive. Disabling the workspace root
 *    puts Metro's base back on apps/rider, which is what the relative path was
 *    computed against. Module resolution still reaches the hoisted root
 *    node_modules — metro.config.js lists it in `nodeModulesPaths`.
 *
 *    Only the release build takes this path; the dev client bundles over Metro
 *    with an absolute entry and never hits it.
 *
 * 2. The ABI list. The prebuilt default is all four architectures, which
 *    doubles the file for two ABIs no physical phone uses. arm64-v8a covers
 *    every Android phone made since ~2015; armeabi-v7a is there for older ones.
 *
 * The APK is signed with the DEBUG keystore (the Expo prebuild default, see
 * android/app/build.gradle `signingConfigs`). That is fine for sideloading and
 * unacceptable for Play — a store build needs a real keystore and a release
 * signing config.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = join(appRoot, 'android');
const all = process.argv.includes('--all');
const abis = all ? 'armeabi-v7a,arm64-v8a,x86,x86_64' : 'arm64-v8a,armeabi-v7a';

if (!existsSync(androidDir)) {
  console.error('android/ is missing — run `npx expo prebuild -p android` first.');
  process.exit(1);
}

console.log(`Building release APK (${abis})…`);
execFileSync(
  process.platform === 'win32' ? 'gradlew.bat' : './gradlew',
  ['assembleRelease', `-PreactNativeArchitectures=${abis}`, '--no-daemon'],
  {
    cwd: androidDir,
    stdio: 'inherit',
    env: { ...process.env, EXPO_NO_METRO_WORKSPACE_ROOT: '1' },
  },
);

const built = join(androidDir, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
if (!existsSync(built)) {
  console.error(`Gradle reported success but ${built} is missing.`);
  process.exit(1);
}

// Land it somewhere with a name that says what it is — `app-release.apk` tells
// the person you send it to nothing.
const { version } = JSON.parse(
  execFileSync('node', ['-p', "JSON.stringify({version: require('./package.json').version})"], {
    cwd: appRoot, encoding: 'utf8',
  }),
);
const outDir = join(appRoot, 'build');
mkdirSync(outDir, { recursive: true });
const brand = process.env.EXPO_PUBLIC_BRAND || 'penny';
const out = join(outDir, `${brand}-ops-${version}-${all ? 'universal' : 'arm'}.apk`);
copyFileSync(built, out);

console.log(`\n${out}  (${(statSync(out).size / 1024 / 1024).toFixed(1)} MB)`);
