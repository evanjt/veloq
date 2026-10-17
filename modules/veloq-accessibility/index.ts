// Native bridge for the system's accessibility display settings. The app consumes the native
// module via requireOptionalNativeModule('VeloqAccessibility') in src/theme/typography.ts and
// src/shared/ui/buttonShapes.ts.
// This entry exists so the local module resolves as a package; Expo autolinking
// registers the native side from expo-module.config.json, independent of this file.
export {};
