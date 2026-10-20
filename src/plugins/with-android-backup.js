const {
  withAndroidManifest,
  AndroidConfig,
} = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

/**
 * Expo config plugin that turns Android's own backup off for the app.
 *
 * Android's backup is invisible to the app and restores at install, before
 * the first launch, so whatever it carried would take effect before the
 * athlete could accept it, and under any restore they chose themselves. The
 * app's backups travel through the destinations the athlete sets up instead.
 *
 * `android:allowBackup="false"` stops the cloud backup on every version and
 * the device-to-device transfer up to Android 11. From Android 12 that
 * transfer ignores the attribute and reads `android:dataExtractionRules`, so
 * those rules exclude every domain. They replace the rules expo-secure-store's
 * own plugin names, which carry shared preferences.
 */

const DOMAINS = [
  "root",
  "file",
  "database",
  "sharedpref",
  "external",
  "device_root",
  "device_file",
  "device_database",
  "device_sharedpref",
];

const EXCLUDE_ALL = DOMAINS.map(
  (domain) => `    <exclude domain="${domain}" path="." />`
).join("\n");

const DATA_EXTRACTION_RULES = `<?xml version="1.0" encoding="utf-8"?>
<!-- Veloq carries nothing in Android's backup or device transfer -->
<data-extraction-rules>
  <cloud-backup>
${EXCLUDE_ALL}
  </cloud-backup>
  <device-transfer>
${EXCLUDE_ALL}
  </device-transfer>
</data-extraction-rules>
`;

/**
 * Turn backup off and point the Android 12 rules at this app's, removing the
 * backup agent and the Android 11 rules a previous configuration named.
 */
function configureManifest(mainApplication) {
  mainApplication.$["android:allowBackup"] = "false";
  mainApplication.$["android:dataExtractionRules"] =
    "@xml/veloq_data_extraction_rules";
  delete mainApplication.$["android:fullBackupContent"];
  delete mainApplication.$["android:backupAgent"];
  delete mainApplication.$["android:fullBackupOnly"];
}

/** Write the rules file into an `res/xml` directory, creating it if needed. */
function writeRules(resDir) {
  fs.mkdirSync(resDir, { recursive: true });
  fs.writeFileSync(
    path.join(resDir, "veloq_data_extraction_rules.xml"),
    DATA_EXTRACTION_RULES
  );
}

function withAndroidBackup(config) {
  config = withAndroidManifest(config, async (mod) => {
    writeRules(
      path.join(
        mod.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "res",
        "xml"
      )
    );

    configureManifest(
      AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults)
    );

    return mod;
  });

  return config;
}

module.exports = withAndroidBackup;
module.exports.DATA_EXTRACTION_RULES = DATA_EXTRACTION_RULES;
module.exports.configureManifest = configureManifest;
module.exports.writeRules = writeRules;
