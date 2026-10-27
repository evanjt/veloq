#!/usr/bin/env sh
# Raw store captures on a clean device: status bar demo mode, light system
# chrome, then the Maestro flow once per store language, then restore. Maestro
# cannot set the status bar, so it happens here.
#
#   scripts/store-capture.sh android [<play>=<app> ...]
#   scripts/store-capture.sh ios <udid|booted> [<play>=<app> ...]
#
# Each pair is a captured Play locale and the app's code for its language, as
# `npx tsx scripts/store-locales.ts capture` prints them; with none given,
# every one is captured. A locale's captures land in
# artifacts/store/raw/android/<play>/ (VELOQ_STORE_RAW overrides the root),
# where `npm run store:render` reads them. The iOS run is
# scripts/store-capture-ios.sh, and `npm run store:screenshots` runs both.
#
# The website's locale is captured a second time in the dark theme, into a
# dark/ folder beside its light shots. The device's dark mode is set off for
# the run and put back as it was when the run ends, however it ends.
#
# Demo mode is entered by the flow, which refuses an app signed into a real
# account, so run this on a device or simulator holding no session. A dev
# build is refused before anything is captured, since its warning toasts reach
# the shots (scripts/store-capture-build-check.sh).

set -eu

usage() {
  echo "usage: scripts/store-capture.sh android [<play>=<app> ...] | ios <udid|booted> [<play>=<app> ...]" >&2
  exit 2
}

[ "$#" -ge 1 ] || usage
case "$1" in
  android) ;;
  ios)
    [ "$#" -ge 2 ] || usage
    shift
    exec "$(dirname "$0")/store-capture-ios.sh" "$@"
    ;;
  *) usage ;;
esac

# A flow's launchApp force-stops the app, so the run holds the device.
if [ -z "${VELOQ_DEVICE_LOCK_HELD:-}" ]; then
  exec "$(dirname "$0")/with-device-lock.sh" "$0" "$@"
fi
shift

here=$(cd "$(dirname "$0")" && pwd)
cd "$here/.."
out=screenshots/store-capture
dest=${VELOQ_STORE_RAW:-artifacts/store/raw}/android
maestro_run=${VELOQ_STORE_MAESTRO:-$here/with-maestro.sh}
web_locale=$(npx --no-install tsx scripts/store-locales.ts web 2>/dev/null || echo en-AU)

if [ "$#" -eq 0 ]; then
  set -- $(npx --no-install tsx scripts/store-locales.ts capture 2>/dev/null)
  [ "$#" -gt 0 ] || { echo "store capture: no capture locales" >&2; exit 1; }
fi

"$here/store-capture-build-check.sh" android

demo() {
  adb shell am broadcast -a com.android.systemui.demo -e command "$@" >/dev/null
}

# `cmd uimode night` answers "Night mode: yes", "no", "auto" or "custom".
night=$(adb shell cmd uimode night | tr -d '\r' | sed -n -E 's/^Night mode: *([a-z]+).*/\1/p')

release() {
  demo exit || true
  if [ -n "$night" ]; then
    adb shell cmd uimode night "$night" >/dev/null || true
  fi
  rm -rf "$out"
}

adb shell settings put global sysui_demo_allowed 1
trap release EXIT
trap 'exit 130' INT TERM HUP
demo enter
demo clock -e hhmm 0941
demo battery -e level 100 -e plugged false
demo network -e wifi show -e level 4 -e fully true
demo network -e mobile hide
demo notifications -e visible false
adb shell cmd uimode night no >/dev/null

for pair in "$@"; do
  play=${pair%%=*}
  app=${pair#*=}
  if [ -z "$play" ] || [ "$app" = "$pair" ]; then
    echo "store capture: '$pair' is not <play>=<app>" >&2
    exit 2
  fi
  echo "store capture: android $play, app language $app"
  rm -rf "$out"
  mkdir -p "$out"
  "$maestro_run" test -e "STORE_LANGUAGE=$app" -e STORE_THEME=light .maestro/store-capture.yaml
  rm -rf "${dest:?}/$play"
  mkdir -p "$dest/$play"
  mv "$out"/*.png "$dest/$play"/
  if [ "$play" = "$web_locale" ]; then
    echo "store capture: android $play, dark theme"
    rm -rf "$out"
    mkdir -p "$out"
    "$maestro_run" test -e "STORE_LANGUAGE=$app" -e STORE_THEME=dark .maestro/store-capture.yaml
    mkdir -p "$dest/$play/dark"
    mv "$out"/*.png "$dest/$play/dark"/
  fi
done
ls "$dest"
