const { withAppBuildGradle } = require("@expo/config-plugins");

/**
 * Expo config plugin that fixes duplicate class and native library conflicts
 * during Android builds.
 *
 * Fixes:
 * 1. Duplicate androidx.annotation.experimental.R class error
 *    - Forces a single version of annotation-experimental
 *
 * 2. Duplicate libfbjni.so error during androidTest builds
 *    - Adds pickFirsts to resolve the conflict
 */

function withPackagingOptions(config) {
  return withAppBuildGradle(config, (config) => {
    let contents = config.modResults.contents;

    // Fix 1: Force a single version of annotation-experimental
    if (!contents.includes("annotation-experimental")) {
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

      if (contents.includes("dependencies {")) {
        contents = contents.replace(
          /^dependencies\s*\{/m,
          `${dependencyFix}\ndependencies {`
        );
      } else {
        contents = contents + dependencyFix;
      }
    }

    // Fix 2: Add pickFirsts for libfbjni.so conflict in androidTest builds
    if (!contents.includes("libfbjni.so")) {
      // Find the packagingOptions.jniLibs block and add pickFirsts
      contents = contents.replace(
        /(packagingOptions\s*\{\s*\n\s*jniLibs\s*\{[^}]*)(useLegacyPackaging[^\n]*)/,
        `$1$2\n            // Fix duplicate libfbjni.so conflict\n            pickFirsts += ['**/libfbjni.so']`
      );
    }

    config.modResults.contents = contents;
    return config;
  });
}

module.exports = withPackagingOptions;
