// Native side of src/shared/debug/forcedRenderCrash.tsx, reached through
// requireOptionalNativeModule('VeloqDebugCrash'). Only a debug native build can
// set the request: a receiver in the Android debug source set, or a launch
// argument read inside `#if DEBUG` on iOS. A release build answers no. This
// entry exists so the local module resolves as a package; Expo autolinking
// registers the native side from expo-module.config.json.
export {};
