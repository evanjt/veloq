#!/usr/bin/env sh
# Capture the screen compare set on an iOS simulator:
#
#   scripts/capture-screen-compare-ios.sh <udid|booted>
#
# The captures land in screenshots/compare/<theme>/<screen>.png, and
# `node scripts/screenshot-compare.mjs --platform ios` holds them against the
# goldens. The status bar is overridden for the run, so the clock, the battery
# and the signal draw the same every time, and cleared again when the run ends,
# however it ends.
#
# Demo mode is entered by the flow, which refuses an app signed into a real
# account, so run this on a simulator holding no session.

set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: scripts/capture-screen-compare-ios.sh <udid|booted>" >&2
  exit 2
fi

# Every session on the Mac shares its booted simulator.
if [ -z "${VELOQ_SIM_LOCK_HELD:-}" ]; then
  exec "$(dirname "$0")/with-simulator-lock.sh" "$1" "$0" "$@"
fi
udid=$VELOQ_SIM_LOCK_HELD

here=$(cd "$(dirname "$0")" && pwd)
cd "$here/.."

release() {
  xcrun simctl status_bar "$udid" clear || true
}

trap release EXIT
xcrun simctl status_bar "$udid" override --time 12:00 --dataNetwork wifi --wifiMode active \
  --wifiBars 3 --cellularMode notSupported --batteryState charged --batteryLevel 100

rm -rf screenshots/compare
maestro --device "$udid" test .maestro/screen-compare.yaml
