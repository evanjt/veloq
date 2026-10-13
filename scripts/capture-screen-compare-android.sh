#!/usr/bin/env sh
# Capture the screen compare set on an Android device or emulator:
#
#   scripts/capture-screen-compare-android.sh
#
# The captures land in screenshots/compare/<theme>/<screen>.png, and
# `node scripts/screenshot-compare.mjs --platform android` holds them against
# the goldens. The status bar is pinned with SystemUI demo mode for the run, so
# the clock, the battery and the notification icons draw the same every time,
# and released again when the run ends, however it ends.
#
# Demo mode is entered by the flow, which refuses an app signed into a real
# account, so run this on an emulator or a device holding no session.

set -eu

# A flow's launchApp force-stops the app, so the run holds the device.
if [ -z "${VELOQ_DEVICE_LOCK_HELD:-}" ]; then
  exec "$(dirname "$0")/with-device-lock.sh" "$0" "$@"
fi

here=$(cd "$(dirname "$0")" && pwd)
cd "$here/.."

demo() {
  adb shell am broadcast -a com.android.systemui.demo -e command "$@" >/dev/null
}

release() {
  demo exit || true
}

adb shell settings put global sysui_demo_allowed 1
trap release EXIT
demo enter
demo clock -e hhmm 1200
demo battery -e level 100 -e plugged false
demo network -e wifi show -e level 4 -e fully true
demo network -e mobile hide
demo notifications -e visible false

rm -rf screenshots/compare
"$here/with-maestro.sh" test .maestro/screen-compare.yaml
