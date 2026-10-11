const { withAndroidManifest, AndroidConfig } = require("expo/config-plugins");

/**
 * Expo config plugin that keeps the portrait lock on Android large screens.
 *
 * An app targeting API 36 has `screenOrientation`, `resizeableActivity` and its
 * aspect-ratio limits ignored on any display whose smallest width is 600 dp or
 * more: tablets, a foldable's inner screen, desktop and free-form windows. This
 * property on `MainActivity` opts out of that, so the activity stays portrait
 * as `app.json` sets it.
 *
 * The opt-out is temporary. Android honours it only while the app targets
 * API 36; at targetSdk 37 it is ignored, and the layouts must then work in any
 * window size and orientation.
 */

const RESTRICTED_RESIZABILITY = "android.window.PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY";

/** Give `MainActivity` the property set to true, once however often it runs. */
function restrictResizability(androidManifest) {
  const activity = AndroidConfig.Manifest.getMainActivityOrThrow(androidManifest);
  const others = (activity.property ?? []).filter(
    (item) => item.$?.["android:name"] !== RESTRICTED_RESIZABILITY
  );
  activity.property = [
    ...others,
    { $: { "android:name": RESTRICTED_RESIZABILITY, "android:value": "true" } },
  ];
  return androidManifest;
}

function withAndroidRestrictedResizability(config) {
  return withAndroidManifest(config, (mod) => {
    mod.modResults = restrictResizability(mod.modResults);
    return mod;
  });
}

module.exports = withAndroidRestrictedResizability;
module.exports.RESTRICTED_RESIZABILITY = RESTRICTED_RESIZABILITY;
module.exports.restrictResizability = restrictResizability;
