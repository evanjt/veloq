#!/usr/bin/env sh
# Install and open one built APK while holding the selected handset.
#
#   scripts/install-and-launch-android.sh dev|production metro|standalone
set -eu

if [ -z "${VELOQ_DEVICE_LOCK_HELD:-}" ]; then
  exec "$(dirname "$0")/with-device-lock.sh" "$0" "$@"
fi

cd "$(dirname "$0")/.."
identity=${1:?identity required}
mode=${2:?mode required}
app_id=$(APP_VARIANT=$identity node scripts/lib/app-identity.js appId)
if [ "$mode" = metro ]; then
  scripts/install-apk.sh debug --identity "$identity"
  adb reverse tcp:8081 tcp:8081
  adb shell am start -n "$app_id/.MainActivity" -d "veloq://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"
else
  scripts/install-apk.sh release --identity "$identity"
  adb shell am start -n "$app_id/.MainActivity"
fi
