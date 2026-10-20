#!/usr/bin/env sh
# Raw store captures on an iOS simulator, the iOS half of
# scripts/store-capture.sh:
#
#   scripts/store-capture-ios.sh <udid|booted>
#
# The status bar is overridden for the run and cleared again when it ends,
# however it ends. The captures land in artifacts/store/raw/ios/, or
# artifacts/store/raw/ipad/ when the simulator is an iPad, where
# `npm run store:render` reads them.

set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: scripts/store-capture-ios.sh <udid|booted>" >&2
  exit 2
fi

# Every session on the Mac shares its booted simulator.
if [ -z "${VELOQ_SIM_LOCK_HELD:-}" ]; then
  exec "$(dirname "$0")/with-simulator-lock.sh" "$1" "$0" "$@"
fi
udid=$VELOQ_SIM_LOCK_HELD

here=$(cd "$(dirname "$0")" && pwd)
cd "$here/.."
out=screenshots/store-capture
dest=artifacts/store/raw/ios
if xcrun simctl list devices | grep "$udid" | grep -qi ipad; then
  dest=artifacts/store/raw/ipad
fi

"$here/store-capture-build-check.sh" ios "$udid"

release() {
  xcrun simctl status_bar "$udid" clear || true
}

trap release EXIT
xcrun simctl status_bar "$udid" override --time 9:41 --dataNetwork wifi --wifiMode active \
  --wifiBars 3 --cellularMode notSupported --batteryState charged --batteryLevel 100

rm -rf "$out"
mkdir -p "$out" "$dest"
maestro --device "$udid" test .maestro/store-capture.yaml
mv "$out"/*.png "$dest"/
ls "$dest"

echo "Render composites:   npm run store:render"
echo "Review output:       artifacts/store/"
echo "Install to fastlane: npm run store:install"
