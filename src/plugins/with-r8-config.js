const {
  withGradleProperties,
  withDangerousMod,
} = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

/**
 * Expo config plugin that enables R8 code shrinking and configures ProGuard rules.
 *
 * R8 benefits:
 * - Reduces APK size by ~10-30%
 * - Obfuscates code for security
 * - Generates mapping.txt for crash deobfuscation
 *
 * The mapping file is output to:
 * android/app/build/outputs/mapping/release/mapping.txt
 */

const PROGUARD_RULES = `
# Hermes engine
-keep class com.facebook.hermes.unicode.** { *; }
-keep class com.facebook.jni.** { *; }

# React Native core
-keep class com.facebook.react.** { *; }
-keep class com.facebook.soloader.** { *; }

# Expo modules
-keep class expo.modules.** { *; }
-keepclassmembers class * {
    @expo.modules.kotlin.annotations.* <methods>;
}

# Route matcher native module (UniFFI generated)
-keep class com.veloq.app.routematcher.** { *; }
-keep class uniffi.** { *; }

# MapLibre
-keep class org.maplibre.** { *; }
-dontwarn org.maplibre.**

# OkHttp (used by various networking libraries)
-dontwarn okhttp3.**
-dontwarn okio.**
-keep class okhttp3.** { *; }
-keep class okio.** { *; }

# Keep native methods
-keepclasseswithmembernames class * {
    native <methods>;
}

# Keep Parcelables
-keepclassmembers class * implements android.os.Parcelable {
    static ** CREATOR;
}
`;

function withR8GradleProperties(config) {
  return withGradleProperties(config, (config) => {
    const props = config.modResults;

    // Enable R8 minification for release builds
    const minifyProp = props.find(
      (p) => p.key === "android.enableMinifyInReleaseBuilds"
    );
    if (!minifyProp) {
      props.push({
        type: "property",
        key: "android.enableMinifyInReleaseBuilds",
        value: "true",
      });
    }

    // Enable resource shrinking for release builds
    const shrinkProp = props.find(
      (p) => p.key === "android.enableShrinkResourcesInReleaseBuilds"
    );
    if (!shrinkProp) {
      props.push({
        type: "property",
        key: "android.enableShrinkResourcesInReleaseBuilds",
        value: "true",
      });
    }

    return config;
  });
}

function withProguardRules(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const proguardPath = path.join(
        config.modRequest.platformProjectRoot,
        "app",
        "proguard-rules.pro"
      );

      if (fs.existsSync(proguardPath)) {
        let contents = fs.readFileSync(proguardPath, "utf8");

        // Only add rules if they haven't been added yet
        if (!contents.includes("# Hermes engine")) {
          contents = contents + PROGUARD_RULES;
          fs.writeFileSync(proguardPath, contents);
        }
      }

      return config;
    },
  ]);
}

module.exports = function withR8Config(config) {
  config = withR8GradleProperties(config);
  config = withProguardRules(config);
  return config;
};
