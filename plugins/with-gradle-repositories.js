const { withSettingsGradle } = require("@expo/config-plugins");

/**
 * Expo config plugin that adds explicit repository definitions to settings.gradle.
 *
 * This fixes Maven Central 403 errors in GitHub Actions by ensuring Gradle uses
 * gradlePluginPortal() which properly handles User-Agent headers for plugin resolution.
 *
 * Without this, transitive dependencies like gson:2.9.1 (from foojay-resolver-convention)
 * fail to download with "403 Forbidden" errors in CI environments.
 */
module.exports = function withGradleRepositories(config) {
  return withSettingsGradle(config, (config) => {
    const contents = config.modResults.contents;

    // Skip if repositories block already exists in pluginManagement
    if (contents.includes("repositories {")) {
      return config;
    }

    // Add repositories block after includeBuild(expoPluginsPath)
    config.modResults.contents = contents.replace(
      "includeBuild(expoPluginsPath)",
      `includeBuild(expoPluginsPath)

  repositories {
    gradlePluginPortal()
    google()
    mavenCentral()
  }`
    );

    return config;
  });
};
