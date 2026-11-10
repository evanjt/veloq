// The iOS string catalogues and the widget sample as a generated project must hold them.
//
// Prebuild writes them into `ios/` when it generates the project, from the locale bundles
// and the widget fixture. `prepare-native.mjs` reuses that project while its configuration
// hash matches, and the translations are left out of the hash, so an edited translation
// would not reach the build. This writes the same files again, through the functions the
// plugins call, before an iOS build runs. It does not generate, so no pod install and no
// native rebuild follow from it.

const fs = require('node:fs');
const path = require('node:path');
const { IOSConfig } = require('@expo/config-plugins');
const { selected } = require('./app-identity.js');
const { writeWidgetStrings } = require('../../src/plugins/with-ios-widget.js');
const { writePushExtensionStrings } = require('../../src/plugins/with-ios-push-extension.js');

/** The name the generated iOS project gives its app directory and Xcode project. */
function projectNameFor(env) {
  return IOSConfig.XcodeUtils.sanitizedName(selected(env).name);
}

/**
 * Rewrite the catalogues and the sample under `root/ios` for the identity `env` selects.
 * `bundles` defaults to the locale bundles on disk.
 */
function syncIosStrings(root, env = process.env, bundles) {
  const projectName = projectNameFor(env);
  const platform = path.join(root, 'ios');
  if (!fs.existsSync(path.join(platform, `${projectName}.xcodeproj`))) {
    throw new Error(
      `no ios/${projectName}.xcodeproj to write into; generate it first with node scripts/prepare-native.mjs --platform ios`
    );
  }
  writeWidgetStrings(root, platform, projectName, bundles);
  writePushExtensionStrings(platform, bundles);
}

module.exports = { syncIosStrings, projectNameFor };
