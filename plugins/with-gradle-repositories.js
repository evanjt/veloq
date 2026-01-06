const {
  withSettingsGradle,
  withGradleProperties,
} = require("@expo/config-plugins");

/**
 * Expo config plugin that fixes Maven Central 403 errors in GitHub Actions.
 *
 * Two fixes are applied:
 * 1. Adds explicit repositories to settings.gradle pluginManagement
 * 2. Sets User-Agent header in gradle.properties to avoid Maven Central blocking
 *
 * Without these, transitive dependencies like gson:2.9.1 (from foojay-resolver-convention)
 * fail to download with "403 Forbidden" errors in CI environments.
 */

function withSettingsGradleRepositories(config) {
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
}

function withGradleUserAgent(config) {
  return withGradleProperties(config, (config) => {
    // Add User-Agent system property to avoid Maven Central 403 errors
    // Maven Central blocks requests without proper User-Agent headers
    const userAgentProp = config.modResults.find(
      (p) => p.key === "systemProp.http.agent"
    );

    if (!userAgentProp) {
      config.modResults.push({
        type: "property",
        key: "systemProp.http.agent",
        value: "Gradle",
      });
    }

    return config;
  });
}

module.exports = function withGradleRepositories(config) {
  config = withSettingsGradleRepositories(config);
  config = withGradleUserAgent(config);
  return config;
};
