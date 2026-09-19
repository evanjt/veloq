// Native side of src/shared/native/appGroup.ts, reached through
// requireOptionalNativeModule('VeloqAppGroup'). There is no Android side:
// there is no shared container there and the database stays in the app's own
// files directory. This entry exists so the local module resolves as a
// package; Expo autolinking registers the native side from
// expo-module.config.json.
export {};
