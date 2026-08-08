module.exports = function (api) {
  api.cache(true);
  return {
    // babel-preset-expo (SDK 54) auto-includes expo-router + the
    // reanimated/worklets babel plugin when those packages are installed,
    // so we don't add them manually here.
    presets: ['babel-preset-expo'],
  };
};
