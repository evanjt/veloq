const IS_PROD = process.env.APP_VARIANT === 'production';

module.exports = ({ config }) => ({
  ...config,
  plugins: [...(config.plugins || []), 'react-native-iap'],
  name: IS_PROD ? config.name : 'Veloq Dev',
  android: {
    ...config.android,
    package: IS_PROD ? config.android.package : 'com.veloq.app.dev',
  },
  ios: {
    ...config.ios,
    bundleIdentifier: IS_PROD ? config.ios.bundleIdentifier : 'com.veloq.app.dev',
  },
});
