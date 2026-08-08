module.exports = function (api) {
  api.cache(true);
  return {
    // babel-preset-expo covers expo-router + RN + TS/JSX.
    // Path alias `@/*` is resolved by Metro (see metro.config.js), so no
    // extra Babel plugin (module-resolver) is required.
    presets: ['babel-preset-expo'],
  };
};
