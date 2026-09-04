const {
  withAndroidManifest,
  AndroidConfig,
} = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

/**
 * Expo config plugin that configures Android Auto Backup to include
 * the Veloq SQLite database while excluding sensitive data.
 *
 * Two files, because the platform changed which one it reads.
 * `android:fullBackupContent` applies to Android 11 and lower;
 * `android:dataExtractionRules` applies from Android 12, and covers the
 * cloud backup and the device-to-device transfer separately. Both name:
 * - shared preferences (settings)
 * - the routes.db SQLite database
 * - the backups/ directory (local backup copies)
 * and both exclude SecureStore (API keys, OAuth tokens).
 *
 * Only listed paths are backed up; all others (gps_tracks, terrain_previews,
 * etc.) are excluded implicitly. The exclusions here replace the ones
 * expo-secure-store's own rules carry, because only one file can be named by
 * each attribute and this one is it.
 */

const BACKUP_RULES = `<?xml version="1.0" encoding="utf-8"?>
<!-- Veloq Auto Backup rules for Android 11 and lower -->
<full-backup-content>
  <!-- Include shared preferences (app settings) -->
  <include domain="sharedpref" path="." />
  <!-- Include SQLite database (activities, sections, settings) -->
  <include domain="file" path="routes.db" />
  <!-- Include local backup copies -->
  <include domain="file" path="backups/" />
  <!-- Exclude sensitive credential storage -->
  <exclude domain="sharedpref" path="SecureStore" />
</full-backup-content>
`;

const DATA_EXTRACTION_RULES = `<?xml version="1.0" encoding="utf-8"?>
<!-- Veloq Auto Backup rules for Android 12 and higher -->
<data-extraction-rules>
  <cloud-backup>
    <include domain="sharedpref" path="." />
    <include domain="file" path="routes.db" />
    <include domain="file" path="backups/" />
    <exclude domain="sharedpref" path="SecureStore" />
  </cloud-backup>
  <device-transfer>
    <include domain="sharedpref" path="." />
    <include domain="file" path="routes.db" />
    <include domain="file" path="backups/" />
    <exclude domain="sharedpref" path="SecureStore" />
  </device-transfer>
</data-extraction-rules>
`;

/**
 * Point both attributes at this app's rules. `dataExtractionRules` is
 * overwritten rather than left alone: expo-secure-store's plugin sets it to
 * its own file, which carries shared preferences and nothing else, so leaving
 * it is how the database stopped being backed up from Android 12 onwards.
 */
function configureManifest(mainApplication) {
  mainApplication.$["android:fullBackupContent"] = "@xml/veloq_backup_rules";
  mainApplication.$["android:dataExtractionRules"] =
    "@xml/veloq_data_extraction_rules";
}

/** Write both rules files into an `res/xml` directory, creating it if needed. */
function writeRules(resDir) {
  fs.mkdirSync(resDir, { recursive: true });
  fs.writeFileSync(path.join(resDir, "veloq_backup_rules.xml"), BACKUP_RULES);
  fs.writeFileSync(
    path.join(resDir, "veloq_data_extraction_rules.xml"),
    DATA_EXTRACTION_RULES
  );
}

function withAndroidBackup(config) {
  // Write the backup rules XML files during prebuild
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
module.exports.BACKUP_RULES = BACKUP_RULES;
module.exports.DATA_EXTRACTION_RULES = DATA_EXTRACTION_RULES;
module.exports.configureManifest = configureManifest;
module.exports.writeRules = writeRules;
