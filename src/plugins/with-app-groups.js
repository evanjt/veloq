const { withEntitlementsPlist } = require("expo/config-plugins");

/**
 * Expo config plugin that enables the App Group shared container.
 *
 * The home-screen widget runs in a separate process and reads a snapshot file the
 * main app writes. An App Group is the shared sandbox both sides use. This is the
 * only new iOS capability the widget needs — no user-facing permission, no runtime
 * prompt. Automatic signing (Xcode / EAS) registers the group at build time.
 *
 * The id is FIXED (`group.com.veloq.app`), mirroring `with-icloud.js` which pins
 * `iCloud.com.veloq.app` for every variant. App Groups are shared containers keyed
 * by group id, not by bundle id, so dev (`com.veloq.app.dev`) and production
 * (`com.veloq.app`) can use the same group without colliding. One group id means one
 * capability to register on the Apple Developer portal and one path the widget reads.
 *
 * The widget extension target must declare the SAME group in its own entitlements.
 * Because the native dirs are checked in (no prebuild), this is also mirrored by hand
 * into `ios/VeloqDev/VeloqDev.entitlements` and `ios/VeloqWidget/VeloqWidget.entitlements`.
 */

const APP_GROUP = "group.com.veloq.app";

module.exports = function withAppGroups(config) {
  return withEntitlementsPlist(config, (mod) => {
    const key = "com.apple.security.application-groups";
    const existing = Array.isArray(mod.modResults[key]) ? mod.modResults[key] : [];
    if (!existing.includes(APP_GROUP)) {
      mod.modResults[key] = [...existing, APP_GROUP];
    }
    return mod;
  });
};
