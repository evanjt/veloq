const { buildStamp } = require('./scripts/lib/build-stamp.js');

const IS_PROD = process.env.APP_VARIANT === 'production';

// expo-constants regenerates this config on every native build and writes it
// into `assets/app.config`, so the commit lands in the APK and in
// `Constants.expoConfig` without a native module of its own.
module.exports = ({ config }) => ({
  ...config,
  name: IS_PROD ? config.name : 'Veloq Dev',
  android: {
    ...config.android,
    package: IS_PROD ? config.android.package : 'com.veloq.app.dev',
  },
  ios: {
    ...config.ios,
    bundleIdentifier: IS_PROD ? config.ios.bundleIdentifier : 'com.veloq.app.dev',
  },
  extra: {
    ...config.extra,
    buildCommit: buildStamp(__dirname),
  },
});
