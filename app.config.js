const { IDENTITIES, selected } = require('./scripts/lib/app-identity.js');
const { buildStamp } = require('./scripts/lib/build-stamp.js');

// expo-constants regenerates this config on every native build and writes it
// into `assets/app.config`, so the commit lands in the APK and in
// `Constants.expoConfig` without a native module of its own.
module.exports = ({ config }) => {
  const identity = selected(process.env);
  return {
    ...config,
    name: identity.name,
    android: { ...config.android, package: identity.appId },
    ios: { ...config.ios, bundleIdentifier: identity.appId },
    plugins:
      identity === IDENTITIES.production
        ? config.plugins
        : [...(config.plugins ?? []), './src/plugins/with-storekit-configuration'],
    extra: {
      ...config.extra,
      buildCommit: buildStamp(__dirname),
    },
  };
};
