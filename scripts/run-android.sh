#!/usr/bin/env sh
# Build before taking the handset lock, then install and launch one pinned device.
#
#   scripts/run-android.sh dev metro          Veloq Dev, debug build, served by Metro
#   scripts/run-android.sh dev standalone     Veloq Dev, release build, embedded JavaScript
#   scripts/run-android.sh production         Veloq, which is only ever standalone
set -eu

cd "$(dirname "$0")/.."

# The identity and the compile mode are both named, so neither is read from
# whatever the caller exported, and a release build is not taken to mean Veloq.
usage() {
  echo "usage: scripts/run-android.sh dev metro|standalone, or production [standalone]" >&2
  exit 2
}
case "${1:-} ${2:-}" in
"dev metro") mode=metro ;;
"dev standalone") mode=standalone ;;
"production " | "production standalone") mode=standalone ;;
*) usage ;;
esac
[ "$#" -le 2 ] || usage
identity=$1
APP_VARIANT=$identity
export APP_VARIANT

# Select the device before either lock. Both adb and the device lock use this serial.
. scripts/device-lock-path.sh
veloq_refuse_if_ambiguous run-android || exit 2
veloq_refuse_if_not_test_device run-android || exit 2
if [ -z "$VELOQ_DEVICE_SERIAL" ]; then
  echo "run-android: connect a device or set ANDROID_SERIAL" >&2
  exit 2
fi
ANDROID_SERIAL=$VELOQ_DEVICE_SERIAL
export ANDROID_SERIAL

if [ "$mode" = metro ]; then
  scripts/with-android-build-lock.sh sh -ec '
    node scripts/prepare-native.mjs --platform android
    node scripts/check-toolchain.mjs --platform android
    node scripts/sync-android-widgets.mjs
    node scripts/check-native-tree.mjs
    npm run bundle:android
    (cd android && ./gradlew assembleDebug)
    node scripts/build-record.js write debug
  '
else
  scripts/with-android-build-lock.sh sh -ec '
    node scripts/prepare-native.mjs --platform android
    node scripts/check-toolchain.mjs --platform android
    node scripts/sync-android-widgets.mjs
    node scripts/check-native-tree.mjs
    node scripts/build-record.js snapshot android release
    (cd android && ./gradlew assembleRelease)
    node scripts/build-record.js write release
  '
fi

# This process starts only after the build command exits and releases its lock.
scripts/install-and-launch-android.sh "$identity" "$mode"

if [ "$mode" = metro ]; then
  exec npx expo start --dev-client --localhost
fi
