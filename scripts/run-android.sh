#!/usr/bin/env sh
# Build before taking the handset lock, then install and launch one pinned device.
set -eu

cd "$(dirname "$0")/.."

case "${1:-}" in
debug) variant=debug; app_id=com.veloq.app.dev ;;
release) variant=release; app_id=com.veloq.app ;;
*) echo "usage: scripts/run-android.sh debug|release" >&2; exit 2 ;;
esac

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
    node scripts/check-toolchain.mjs
    npm run bundle:android
    (cd android && ./gradlew assembleDebug)
    node scripts/build-record.js write debug
  '
else
  APP_VARIANT=production
  export APP_VARIANT
  scripts/with-android-build-lock.sh sh -ec '
    node scripts/check-toolchain.mjs
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
