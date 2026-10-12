const { IDENTITIES, selected } = require('./scripts/lib/app-identity.js');
const { buildStamp } = require('./scripts/lib/build-stamp.js');
const { infoPlistFallback } = require('./src/plugins/nativeStrings.js');
const appColours = require('./src/theme/appColours.json');

// Native code draws these before any JavaScript runs, so prebuild writes them
// from the same token file the app's palette reads, and app.json holds none.
function withNativeColours(config) {
  const options = {
    'expo-splash-screen': (props) => ({
      ...props,
      backgroundColor: appColours.appColour,
      dark: { ...props.dark, backgroundColor: appColours.appColour },
    }),
    'expo-notifications': (props) => ({ ...props, color: appColours.notificationAccent }),
  };
  return {
    ...config,
    android: {
      ...config.android,
      adaptiveIcon: { ...config.android?.adaptiveIcon, backgroundColor: appColours.appColour },
    },
    plugins: (config.plugins ?? []).map((plugin) => {
      const [name, props] = Array.isArray(plugin) ? plugin : [plugin, {}];
      return options[name] ? [name, options[name](props)] : plugin;
    }),
  };
}

// expo-constants regenerates this config on every native build and writes it
// into `assets/app.config`, so the commit lands in the APK and in
// `Constants.expoConfig` without a native module of its own.
module.exports = ({ config: input }) => {
  const identity = selected(process.env);
  const config = withNativeColours(input);
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
