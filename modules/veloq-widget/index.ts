// Native bridge for the home-screen widget. The app consumes the native module via
// requireOptionalNativeModule('VeloqWidget') in
// src/features/home/lib/widgetBridge.ts. This entry exists so the local module
// resolves as a package; Expo autolinking registers the native side from
// expo-module.config.json, independent of this file.
export {};
