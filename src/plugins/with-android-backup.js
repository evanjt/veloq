const {
  withAndroidManifest,
  AndroidConfig,
} = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

/**
 * Expo config plugin that configures Android Auto Backup to include
 * the latest record zip while excluding sensitive data.
 *
 * Two files, because the platform changed which one it reads.
 * `android:fullBackupContent` applies to Android 11 and lower;
 * `android:dataExtractionRules` applies from Android 12, and covers the
 * cloud backup and the device-to-device transfer separately. Both name:
 * - shared preferences (settings)
 * - the latest versioned record zip
 * and both exclude SecureStore (API keys, OAuth tokens) and the backup agent's
 * own record, which describes this phone and would mislead on another.
 *
 * Only listed paths are backed up; all others (gps_tracks, terrain_previews,
 * etc.) are excluded implicitly. The exclusions here replace the ones
 * expo-secure-store's own rules carry, because only one file can be named by
 * each attribute and this one is it.
 */

/**
 * The backup agent in the backup module, which records when Android last backed
 * the app up, its size, a quota overrun and a restore. Android tells the app
 * nothing of these otherwise.
 */
const BACKUP_AGENT = "com.veloq.backupexclusion.VeloqBackupAgent";

/** The preferences file the agent keeps its record in. */
const AGENT_PREFERENCES = "veloq_auto_backup.xml";

const BACKUP_RULES = `<?xml version="1.0" encoding="utf-8"?>
<!-- Veloq Auto Backup rules for Android 11 and lower -->
<full-backup-content>
  <!-- Include shared preferences (app settings) -->
  <include domain="sharedpref" path="." />
  <!-- Include the latest record zip -->
  <include domain="file" path="veloq-decisions.zip" />
  <!-- Exclude sensitive credential storage -->
  <exclude domain="sharedpref" path="SecureStore" />
  <!-- Exclude the backup agent's record of this phone's backups -->
  <exclude domain="sharedpref" path="${AGENT_PREFERENCES}" />
</full-backup-content>
`;

const DATA_EXTRACTION_RULES = `<?xml version="1.0" encoding="utf-8"?>
<!-- Veloq Auto Backup rules for Android 12 and higher -->
<data-extraction-rules>
  <cloud-backup>
    <include domain="sharedpref" path="." />
    <include domain="file" path="veloq-decisions.zip" />
    <exclude domain="sharedpref" path="SecureStore" />
    <exclude domain="sharedpref" path="${AGENT_PREFERENCES}" />
  </cloud-backup>
  <device-transfer>
    <include domain="sharedpref" path="." />
    <include domain="file" path="veloq-decisions.zip" />
    <exclude domain="sharedpref" path="SecureStore" />
    <exclude domain="sharedpref" path="${AGENT_PREFERENCES}" />
  </device-transfer>
</data-extraction-rules>
`;

/**
 * Point both attributes at this app's rules. `dataExtractionRules` is
 * overwritten rather than left alone: expo-secure-store's plugin sets it to
 * its own file, which carries shared preferences and nothing else, so leaving
 * it is how the record zip would be omitted from Android 12 backups.
 *
 * Naming an agent alone would switch the app to key-value backup, which the
 * rules files do not govern; `fullBackupOnly` keeps the full backup they
 * describe and has the agent called for it.
 */
function configureManifest(mainApplication) {
  mainApplication.$["android:fullBackupContent"] = "@xml/veloq_backup_rules";
  mainApplication.$["android:dataExtractionRules"] =
    "@xml/veloq_data_extraction_rules";
  mainApplication.$["android:backupAgent"] = BACKUP_AGENT;
  mainApplication.$["android:fullBackupOnly"] = "true";
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
module.exports.BACKUP_AGENT = BACKUP_AGENT;
module.exports.AGENT_PREFERENCES = AGENT_PREFERENCES;
module.exports.BACKUP_RULES = BACKUP_RULES;
module.exports.DATA_EXTRACTION_RULES = DATA_EXTRACTION_RULES;
module.exports.configureManifest = configureManifest;
module.exports.writeRules = writeRules;
