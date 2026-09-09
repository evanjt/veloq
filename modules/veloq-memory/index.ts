// Native bridge for Android memory pressure. The app consumes the native module via
// requireOptionalNativeModule('VeloqMemory') in src/shared/app/memoryPressure.ts.
// This entry exists so the local module resolves as a package; Expo autolinking
// registers the native side from expo-module.config.json, independent of this file.
export {};
