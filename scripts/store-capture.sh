#!/usr/bin/env sh
# Raw store captures on a clean device: status bar demo mode, dark system
# chrome, then the Maestro flow, then restore. Maestro cannot set the status
# bar, so it happens here.
#
#   scripts/store-capture.sh android
#   scripts/store-capture.sh ios <udid|booted>
#
# The captures land in artifacts/store/raw/<android|ios|ipad>/, where
# `npm run store:render` reads them. The iOS run is scripts/store-capture-ios.sh.
#
# Demo mode is entered by the flow, which refuses an app signed into a real
# account, so run this on a device or simulator holding no session. A dev
# build is refused before anything is captured, since its warning toasts reach
# the shots (scripts/store-capture-build-check.sh).

set -eu

usage() {
  echo "usage: scripts/store-capture.sh android | ios <udid|booted>" >&2
  exit 2
}

[ "$#" -ge 1 ] || usage
case "$1" in
  android) [ "$#" -eq 1 ] || usage ;;
  ios)
    [ "$#" -eq 2 ] || usage
    exec "$(dirname "$0")/store-capture-ios.sh" "$2"
    ;;
  *) usage ;;
esac

# A flow's launchApp force-stops the app, so the run holds the device.
if [ -z "${VELOQ_DEVICE_LOCK_HELD:-}" ]; then
  exec "$(dirname "$0")/with-device-lock.sh" "$0" "$@"
fi

here=$(cd "$(dirname "$0")" && pwd)
cd "$here/.."
out=screenshots/store-capture
dest=artifacts/store/raw/android

"$here/store-capture-build-check.sh" android

demo() {
  adb shell am broadcast -a com.android.systemui.demo -e command "$@" >/dev/null
}

release() {
  demo exit || true
}

adb shell settings put global sysui_demo_allowed 1
trap release EXIT
demo enter
demo clock -e hhmm 0941
demo battery -e level 100 -e plugged false
demo network -e wifi show -e level 4 -e fully true
demo network -e mobile hide
demo notifications -e visible false
adb shell cmd uimode night yes

rm -rf "$out"
mkdir -p "$out" "$dest"
"$here/with-maestro.sh" test .maestro/store-capture.yaml
mv "$out"/*.png "$dest"/
ls "$dest"

echo "Render composites:   npm run store:render"
echo "Review output:       artifacts/store/"
echo "Install to fastlane: npm run store:install"
