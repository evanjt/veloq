#!/usr/bin/env sh
# Create the Android store emulator named in scripts/store-device.ts, so a
# retake on any machine captures on the same screen. Does nothing when it
# already exists. avdmanager gives the device profile's own size, which is then
# replaced with the store size in the AVD's config.ini.
#
#   scripts/store-avd-create.sh

set -eu

here=$(cd "$(dirname "$0")" && pwd)
cd "$here/.."
field() { npm_config_loglevel=silent npx --no-install tsx scripts/store-device.ts field "$1"; }
name=$(field name)
image=$(field image)
device=$(field device)

avdmanager=$(command -v avdmanager || true)
if [ -z "$avdmanager" ]; then
  sdk=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}
  avdmanager=$sdk/cmdline-tools/latest/bin/avdmanager
fi
[ -x "$avdmanager" ] || { echo "store avd: no avdmanager" >&2; exit 1; }

avd_home=${ANDROID_AVD_HOME:-$HOME/.android/avd}
if [ -d "$avd_home/$name.avd" ]; then
  echo "store avd: $name exists"
  exit 0
fi

echo no | "$avdmanager" create avd -n "$name" -k "$image" -d "$device"
npx --no-install tsx scripts/store-device.ts config "$avd_home/$name.avd/config.ini"
echo "store avd: created $name"
