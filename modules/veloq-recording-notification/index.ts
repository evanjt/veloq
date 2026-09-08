// Native bridge for the recording notification. The app consumes the module via
// requireOptionalNativeModule('VeloqRecordingNotification') in
// src/features/recording/lib/recordingNotification.ts. This entry exists so the
// local module resolves as a package; Expo autolinking registers the native side
// from expo-module.config.json, independent of this file.
export {};
