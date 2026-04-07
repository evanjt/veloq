const {
  withAndroidManifest,
  AndroidConfig,
} = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

/**
 * Expo config plugin that configures Android Auto Backup to include
 * the Veloq SQLite database while excluding sensitive data.
 *
 * Creates a custom backup_rules.xml that:
 * - Includes shared preferences (settings)
 * - Includes the routes.db SQLite database
 * - Includes the backups/ directory (local backup copies)
 * - Excludes SecureStore (API keys, OAuth tokens)
 * Only listed paths are backed up; all others (gps_tracks, terrain_previews, etc.) are excluded implicitly
 */

const BACKUP_RULES = `<?xml version="1.0" encoding="utf-8"?>
<!-- Veloq Auto Backup rules for Android -->
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

function withAndroidBackup(config) {
  // Write the backup rules XML file during prebuild
  config = withAndroidManifest(config, async (mod) => {
    const resDir = path.join(
      mod.modRequest.platformProjectRoot,
      "app",
      "src",
      "main",
      "res",
      "xml"
    );
    fs.mkdirSync(resDir, { recursive: true });
    fs.writeFileSync(
      path.join(resDir, "veloq_backup_rules.xml"),
      BACKUP_RULES
    );

    // Update the manifest to point to our custom rules
    const mainApplication =
      AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    mainApplication.$["android:fullBackupContent"] =
      "@xml/veloq_backup_rules";

    return mod;
  });

  return config;
}

module.exports = withAndroidBackup;
