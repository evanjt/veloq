const { withGradleProperties } = require("expo/config-plugins");

/**
 * Expo config plugin that turns the Gradle build cache on.
 *
 * A regeneration with `--clean` deletes `android/app/build` and
 * `android/.gradle`, and `npm ci` deletes every library's `android/.cxx`, so
 * without the cache the next build recompiles every native library and every
 * Kotlin module. The cache lives in the Gradle user home, which survives both
 * and is shared by every checkout on the machine.
 */

const BUILD_CACHE = "org.gradle.caching";

/** The properties with the build cache on, set once however often this runs. */
function withBuildCacheProperty(props) {
  const existing = props.find(
    (p) => p.type === "property" && p.key === BUILD_CACHE
  );
  if (existing) {
    existing.value = "true";
  } else {
    props.push({ type: "property", key: BUILD_CACHE, value: "true" });
  }
  return props;
}

module.exports = function withGradleBuildCache(config) {
  return withGradleProperties(config, (config) => {
    config.modResults = withBuildCacheProperty(config.modResults);
    return config;
  });
};
module.exports.withBuildCacheProperty = withBuildCacheProperty;
