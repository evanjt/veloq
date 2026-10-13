// Native bridge for the Android per-app language. The app consumes the native module via
// requireOptionalNativeModule('VeloqLocale') in src/shared/app/appLocale.ts.
// This entry exists so the local module resolves as a package; Expo autolinking
// registers the native side from expo-module.config.json, independent of this file.
export {};
