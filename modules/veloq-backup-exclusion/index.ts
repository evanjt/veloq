// Native side of src/shared/native/backupExclusion.ts, reached through
// requireOptionalNativeModule('VeloqBackupExclusion'). There is no Android
// side: the backup rules there are an allowlist, so an unnamed directory is
// already excluded. This entry exists so the local module resolves as a
// package; Expo autolinking registers the native side from
// expo-module.config.json.
export {};
