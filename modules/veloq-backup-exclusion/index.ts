// Native side of src/shared/native/backupExclusion.ts, replaceFile.ts,
// backupFolder.ts and googleDrive.ts, reached through
// requireOptionalNativeModule('VeloqBackupExclusion'). The Android side holds
// the backup folder's grant release, the save to a place the athlete picks and
// the Google Drive authorisation, and excludes nothing: Android's own backup is off for the
// app, so no directory is in it. This entry exists so
// the local module resolves as a package; Expo autolinking registers the
// native side from expo-module.config.json.
export {};
