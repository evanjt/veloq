const {
  withAndroidManifest,
  AndroidConfig,
} = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

/**
 * Expo config plugin that configures Android Auto Backup to carry the latest
 * record zip and nothing else.
 *
 * Two files, because the platform changed which one it reads.
 * `android:fullBackupContent` applies to Android 11 and lower;
 * `android:dataExtractionRules` applies from Android 12, and covers the
 * cloud backup and the device-to-device transfer separately. Both include the
 * latest versioned record zip alone.
 *
 * No shared preferences file is carried. Settings live in the engine and travel
 * inside the zip, and every preferences file left is this install's state:
 * registered tasks, permission flags, push ids, widget choices keyed by the
 * launcher's widget ids, a pending interrupted-ride notice, SecureStore's
 * credentials and the backup agent's record of this phone. A restore lands at
 * install, before the first launch, so whatever it carries takes effect before
 * the athlete could accept it. The zip waits in `files/` until they do.
 *
 * Only listed paths are backed up; all others (routes.db, gps_tracks,
 * terrain_previews, etc.) are excluded implicitly. These files replace the
 * rules expo-secure-store's own plugin carries, because only one file can be
 * named by each attribute and this one is it.
 */

/**
 * The backup agent in the backup module, which records when Android last backed
 * the app up, its size, a quota overrun and a restore. Android tells the app
 * nothing of these otherwise.
 */
const BACKUP_AGENT = "com.veloq.backupexclusion.VeloqBackupAgent";

const BACKUP_RULES = `<?xml version="1.0" encoding="utf-8"?>
<!-- Veloq Auto Backup rules for Android 11 and lower -->
<full-backup-content>
  <!-- The latest record zip, and nothing else -->
  <include domain="file" path="veloq-decisions.zip" />
</full-backup-content>
`;

const DATA_EXTRACTION_RULES = `<?xml version="1.0" encoding="utf-8"?>
<!-- Veloq Auto Backup rules for Android 12 and higher -->
<data-extraction-rules>
  <cloud-backup>
    <include domain="file" path="veloq-decisions.zip" />
  </cloud-backup>
  <device-transfer>
    <include domain="file" path="veloq-decisions.zip" />
  </device-transfer>
</data-extraction-rules>
`;

/**
 * Point both attributes at this app's rules. `dataExtractionRules` is
 * overwritten rather than left alone: expo-secure-store's plugin sets it to
 * its own file, which carries shared preferences and nothing else, so leaving
 * it would carry this install's preferences and omit the record zip from
 * Android 12 backups.
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
module.exports.BACKUP_RULES = BACKUP_RULES;
module.exports.DATA_EXTRACTION_RULES = DATA_EXTRACTION_RULES;
module.exports.configureManifest = configureManifest;
module.exports.writeRules = writeRules;
