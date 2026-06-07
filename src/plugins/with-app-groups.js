const { withEntitlementsPlist } = require("expo/config-plugins");

/**
 * Expo config plugin that enables the App Group shared container.
 *
 * The home-screen widget runs in a separate process and reads a snapshot file the
 * main app writes. An App Group is the shared sandbox both sides use. This is the
 * only new iOS capability the widget needs — no user-facing permission, no runtime
 * prompt. Automatic signing (Xcode / EAS) registers the group at build time.
 *
 * The group id is derived from the resolved bundle id, so the dev variant
 * (`com.veloq.app.dev`) and production (`com.veloq.app`) stay isolated:
 *   group.com.veloq.app      (prod)
 *   group.com.veloq.app.dev  (dev)
 *
 * The widget extension target must declare the SAME group in its own entitlements.
 */

function appGroupId(config) {
  const bundleId = config.ios?.bundleIdentifier || "com.veloq.app";
  return `group.${bundleId}`;
}

module.exports = function withAppGroups(config) {
  return withEntitlementsPlist(config, (mod) => {
    const group = appGroupId(config);
    const key = "com.apple.security.application-groups";
    const existing = Array.isArray(mod.modResults[key]) ? mod.modResults[key] : [];
    if (!existing.includes(group)) {
      mod.modResults[key] = [...existing, group];
    }
    return mod;
  });
};
