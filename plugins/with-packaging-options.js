const { withAppBuildGradle } = require("@expo/config-plugins");

/**
 * Expo config plugin that fixes duplicate class errors during Android DEX merging.
 *
 * Fixes the "Type androidx.annotation.experimental.R is defined multiple times" error
 * that occurs when multiple dependencies include the same AndroidX annotation classes.
 *
 * This is a common issue with React Native projects using libraries like:
 * - @maplibre/maplibre-react-native
 * - @shopify/react-native-skia
 * - react-native-reanimated
 * - react-native-gesture-handler
 * - react-native-screens
 *
 * Solution: Force a single version of annotation-experimental across all dependencies
 * to prevent duplicate R.class files during DEX merging.
 */

function withPackagingOptions(config) {
  return withAppBuildGradle(config, (config) => {
    const contents = config.modResults.contents;

    // Skip if fix already exists
    if (contents.includes("annotation-experimental")) {
      return config;
    }

    // Force a single version of annotation-experimental to fix duplicate R class
    const dependencyFix = `

// Fix duplicate class: androidx.annotation.experimental.R
// Multiple dependencies pull in different versions of annotation-experimental,
// causing duplicate R.class during DEX merging. Force a single version.
configurations.configureEach {
    resolutionStrategy {
        force 'androidx.annotation:annotation-experimental:1.4.1'
    }
}
`;

    // Insert before the dependencies block at the end of the file
    // or after android block closes
    if (contents.includes("dependencies {")) {
      // Insert before the first dependencies block
      config.modResults.contents = contents.replace(
        /^dependencies\s*\{/m,
        `${dependencyFix}\ndependencies {`
      );
    } else {
      // Fallback: append to end of file
      config.modResults.contents = contents + dependencyFix;
    }

    return config;
  });
}

module.exports = withPackagingOptions;
