// Native side of src/shared/native/backupExclusion.ts, replaceFile.ts,
// backupFolder.ts and googleDrive.ts, reached through
// requireOptionalNativeModule('VeloqBackupExclusion'). The Android side holds
// the backup folder's grant release and the Google Drive authorisation, and
// excludes nothing: the backup rules there are an allowlist, so an unnamed
// directory is already excluded. This entry exists so
// the local module resolves as a package; Expo autolinking registers the
// native side from expo-module.config.json.
export {};
