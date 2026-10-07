#!/usr/bin/env sh
# Install and open one built APK while holding the selected handset.
set -eu

if [ -z "${VELOQ_DEVICE_LOCK_HELD:-}" ]; then
  exec "$(dirname "$0")/with-device-lock.sh" "$0" "$@"
fi

cd "$(dirname "$0")/.."
variant=${1:?variant required}
app_id=${2:?application id required}
scripts/install-apk.sh "$variant"
if [ "$variant" = debug ]; then
  adb reverse tcp:8081 tcp:8081
  adb shell am start -n "$app_id/.MainActivity" -d "veloq://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"
else
  adb shell am start -n "$app_id/.MainActivity"
fi
