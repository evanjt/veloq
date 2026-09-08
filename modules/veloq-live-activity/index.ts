// Native bridge for the recording Live Activity. The app reaches it through
// requireOptionalNativeModule('VeloqLiveActivity') in
// src/features/recording/lib/liveActivity/bridge.ts. There is no Android side:
// the equivalent there is a foreground notification, not a Live Activity. This
// entry exists so the local module resolves as a package; Expo autolinking
// registers the native side from expo-module.config.json.
export {};
