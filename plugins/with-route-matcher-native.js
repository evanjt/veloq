const { withPodfile } = require("@expo/config-plugins");

/**
 * Expo config plugin that adds the RouteMatcherNative pod for the uniffi-bindgen-react-native module.
 *
 * This is needed because expo-modules-autolinking doesn't automatically discover
 * local modules that use react-native.config.js for podspec paths.
 *
 * The TurboModule registration is handled at runtime by VeloqModuleProvider.mm,
 * which swizzles RCTModuleProviders to add the Veloq module to the providers dictionary.
 */
module.exports = function withRouteMatcherNative(config) {
  return withPodfile(config, (config) => {
    const contents = config.modResults.contents;

    // Skip if already added
    if (contents.includes("RouteMatcherNative")) {
      return config;
    }

    // Add the pod after use_expo_modules!
    const podLine = `
  # Local native module for Rust bindings (uniffi-bindgen-react-native)
  pod 'RouteMatcherNative', :path => '../modules/route-matcher-native/ios'
`;

    config.modResults.contents = contents.replace(
      "use_expo_modules!",
      `use_expo_modules!
${podLine}`
    );

    return config;
  });
};
