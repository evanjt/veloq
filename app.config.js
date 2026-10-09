const { IDENTITIES, selected } = require('./scripts/lib/app-identity.js');
const { buildStamp } = require('./scripts/lib/build-stamp.js');
const { infoPlistFallback } = require('./src/plugins/nativeStrings.js');

// expo-constants regenerates this config on every native build and writes it
// into `assets/app.config`, so the commit lands in the APK and in
// `Constants.expoConfig` without a native module of its own.
module.exports = ({ config }) => {
  const identity = selected(process.env);
  return {
    ...config,
    name: identity.name,
    android: { ...config.android, package: identity.appId },
    ios: {
      ...config.ios,
      bundleIdentifier: identity.appId,
      // The permission purpose strings come from the locale bundles, so no
      // plugin falls back to its own English default. Each `InfoPlist.strings`
      // translates them; these are what a language with no table reads.
      infoPlist: {
        ...config.ios?.infoPlist,
        ...infoPlistFallback(config.ios?.infoPlist?.CFBundleDevelopmentRegion),
      },
    },
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
