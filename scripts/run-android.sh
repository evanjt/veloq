#!/usr/bin/env sh
# Build before taking the handset lock, then install and launch one pinned device.
set -eu

cd "$(dirname "$0")/.."

# A debug build is Veloq Dev and a release build is Veloq, whatever the caller exported.
case "${1:-}" in
debug) variant=debug; APP_VARIANT=dev ;;
release) variant=release; APP_VARIANT=production ;;
*) echo "usage: scripts/run-android.sh debug|release" >&2; exit 2 ;;
esac
export APP_VARIANT
app_id=$(node scripts/lib/app-identity.js appId)

# Select the device before either lock. Both adb and the device lock use this serial.
. scripts/device-lock-path.sh
veloq_refuse_if_ambiguous run-android || exit 2
if [ -z "$VELOQ_DEVICE_SERIAL" ]; then
  echo "run-android: connect a device or set ANDROID_SERIAL" >&2
  exit 2
fi
ANDROID_SERIAL=$VELOQ_DEVICE_SERIAL
export ANDROID_SERIAL

if [ "$variant" = debug ]; then
  scripts/with-android-build-lock.sh sh -ec '
    node scripts/prepare-native.mjs --platform android
    node scripts/check-toolchain.mjs
    node scripts/sync-android-widgets.mjs
    node scripts/check-native-tree.mjs
    npm run bundle:android
    (cd android && ./gradlew assembleDebug)
    node scripts/build-record.js write debug
  '
else
  scripts/with-android-build-lock.sh sh -ec '
    node scripts/prepare-native.mjs --platform android
    node scripts/check-toolchain.mjs
    node scripts/sync-android-widgets.mjs
    node scripts/check-native-tree.mjs
    node scripts/build-record.js snapshot android release
    (cd android && ./gradlew assembleRelease)
    node scripts/build-record.js write release
  '
fi

# This process starts only after the build command exits and releases its lock.
scripts/install-and-launch-android.sh "$variant" "$app_id"

if [ "$variant" = debug ]; then
  exec npx expo start --dev-client --localhost
fi
