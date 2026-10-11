const { withAndroidManifest } = require("expo/config-plugins");

/**
 * Expo config plugin that finishes the Android Bluetooth declarations
 * react-native-ble-plx generates.
 *
 * The app reads heart rate, power and cadence sensors and derives no location
 * from a scan, and it records location through its own uncapped grant. So:
 * - `BLUETOOTH_SCAN` says it never derives location, so Android 12 and later
 *   return scan results without a location grant.
 * - `BLUETOOTH` and `BLUETOOTH_ADMIN` stop at Android 11, where
 *   `BLUETOOTH_SCAN` and `BLUETOOTH_CONNECT` replace them.
 * - Bluetooth and Bluetooth LE hardware are optional. The sensor screen draws a
 *   state for a phone without them, and maps, sections and the feed need
 *   neither. Without the `bluetooth` entry the store reads the `BLUETOOTH`
 *   permission as requiring it.
 * - The `uses-permission-sdk-23` location copies the BLE plugin adds are
 *   removed. With `neverForLocation` set they stop at Android 11, and they
 *   would sit beside the app's own uncapped location grant for recording.
 *
 * The BLE plugin writes the flag only when it adds `BLUETOOTH_SCAN` itself, and
 * a prebuild over an existing `android/` already holds the permission, so the
 * flag is set here on whatever entry the manifest carries.
 *
 * A plugin listed earlier edits the manifest later, so this one sits before
 * react-native-ble-plx in the plugin list to see what that plugin wrote.
 */

const SCAN_PERMISSION = "android.permission.BLUETOOTH_SCAN";

const LEGACY_PERMISSIONS = [
  "android.permission.BLUETOOTH",
  "android.permission.BLUETOOTH_ADMIN",
];

const LOCATION_PERMISSIONS = [
  "android.permission.ACCESS_FINE_LOCATION",
  "android.permission.ACCESS_COARSE_LOCATION",
];

const OPTIONAL_FEATURES = [
  "android.hardware.bluetooth",
  "android.hardware.bluetooth_le",
];

/** Apply the declarations above to a parsed AndroidManifest, in place. */
function configureManifest(androidManifest) {
  const manifest = androidManifest.manifest;

  for (const entry of manifest["uses-permission"] ?? []) {
    if (entry.$["android:name"] === SCAN_PERMISSION) {
      entry.$["android:usesPermissionFlags"] = "neverForLocation";
    }
    if (LEGACY_PERMISSIONS.includes(entry.$["android:name"])) {
      entry.$["android:maxSdkVersion"] = "30";
    }
  }

  const sdk23 = (manifest["uses-permission-sdk-23"] ?? []).filter(
    (entry) => !LOCATION_PERMISSIONS.includes(entry.$["android:name"])
  );
  if (sdk23.length > 0) {
    manifest["uses-permission-sdk-23"] = sdk23;
  } else {
    delete manifest["uses-permission-sdk-23"];
  }

  const features = (manifest["uses-feature"] ?? []).filter(
    (entry) => !OPTIONAL_FEATURES.includes(entry.$["android:name"])
  );
  for (const name of OPTIONAL_FEATURES) {
    features.push({ $: { "android:name": name, "android:required": "false" } });
  }
  manifest["uses-feature"] = features;

  return androidManifest;
}

function withAndroidBluetooth(config) {
  return withAndroidManifest(config, (mod) => {
    mod.modResults = configureManifest(mod.modResults);
    return mod;
  });
}

module.exports = withAndroidBluetooth;
module.exports.configureManifest = configureManifest;
