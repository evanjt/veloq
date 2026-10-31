#!/usr/bin/env sh
# Raw store captures on an iOS simulator, the iOS half of
# scripts/store-capture.sh:
#
#   scripts/store-capture-ios.sh <udid|booted> [<play>=<app> ...]
#
# Each pair is a captured Play locale and the app's code for its language, as
# `npx tsx scripts/store-locales.ts capture` prints them; with none given,
# every one is captured. The status bar is overridden and the appearance set to
# light for the run, and both are put back when it ends, however it ends. A
# locale's captures land in artifacts/store/raw/ios/<play>/, or
# artifacts/store/raw/ipad/<play>/ when the simulator is an iPad
# (VELOQ_STORE_RAW overrides the root), where `npm run store:render` reads
# them. The website's locale is captured again in the dark theme into a dark/
# folder beside its light shots. The App Store takes 1320x2868 iPhone and
# 2064x2752 iPad shots, so the simulators are a 6.9-inch iPhone and a 13-inch
# iPad.

set -eu

if [ "$#" -lt 1 ]; then
  echo "usage: scripts/store-capture-ios.sh <udid|booted> [<play>=<app> ...]" >&2
  exit 2
fi

# Every session on the Mac shares its booted simulator.
if [ -z "${VELOQ_SIM_LOCK_HELD:-}" ]; then
  exec "$(dirname "$0")/with-simulator-lock.sh" "$1" "$0" "$@"
fi
udid=$VELOQ_SIM_LOCK_HELD
shift

# A non-interactive shell on the Mac carries no Homebrew or Maestro path.
for dir in /opt/homebrew/bin "$HOME/.maestro/bin"; do
  [ -d "$dir" ] && PATH=$PATH:$dir
done
if [ -z "${JAVA_HOME:-}" ] && [ -d /opt/homebrew/opt/openjdk@21 ]; then
  JAVA_HOME=/opt/homebrew/opt/openjdk@21
  PATH=$JAVA_HOME/bin:$PATH
  export JAVA_HOME
fi
export PATH

here=$(cd "$(dirname "$0")" && pwd)
cd "$here/.."
out=screenshots/store-capture
raw=${VELOQ_STORE_RAW:-artifacts/store/raw}
dest=$raw/ios
if xcrun simctl list devices | grep "$udid" | grep -qi ipad; then
  dest=$raw/ipad
fi
maestro_run=${VELOQ_STORE_MAESTRO:-maestro}
web_locale=$(npx --no-install tsx scripts/store-locales.ts web 2>/dev/null || echo en-AU)

if [ "$#" -eq 0 ]; then
  set -- $(npx --no-install tsx scripts/store-locales.ts capture 2>/dev/null)
  [ "$#" -gt 0 ] || { echo "store capture: no capture locales" >&2; exit 1; }
fi

"$here/store-capture-build-check.sh" ios "$udid"

# The recording shot's map must not show the simulator's empty fix, so the
# declared track is played for the run. `simctl location` takes lat,lng pairs.
track=$(npm_config_loglevel=silent npx --no-install tsx scripts/store-shots.ts track simulator | tr '\n' ' ')

appearance=$(xcrun simctl ui "$udid" appearance 2>/dev/null | tr -d '\r' || true)

release() {
  xcrun simctl location "$udid" clear || true
  xcrun simctl status_bar "$udid" clear || true
  case "$appearance" in
    light | dark) xcrun simctl ui "$udid" appearance "$appearance" || true ;;
  esac
  rm -rf "$out"
}

trap release EXIT
trap 'exit 130' INT TERM HUP
xcrun simctl status_bar "$udid" override --time 9:41 --dataNetwork wifi --wifiMode active \
  --wifiBars 3 --cellularMode notSupported --batteryState charged --batteryLevel 100
xcrun simctl ui "$udid" appearance light
# shellcheck disable=SC2086
[ -z "$track" ] || xcrun simctl location "$udid" start --speed=12 $track

# Each pass starts with the app's own data container emptied. The app is stopped
# first so it does not write into the container while it is cleared. The App
# Group container holds routes.db on iOS and is left alone, since the release
# build shares it; the flow switches debug mode off itself before its first shot.
. "$here/lib/maestro-app-id.sh"
bundle_id=$(veloq_maestro_app_id "$here")
pass() {
  xcrun simctl terminate "$udid" "$bundle_id" >/dev/null 2>&1 || true
  data=$(xcrun simctl get_app_container "$udid" "$bundle_id" data)
  find "$data" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
  "$maestro_run" --device "$udid" test -e "STORE_LANGUAGE=$app" -e "STORE_THEME=$1" .maestro/store-capture.yaml
}

for pair in "$@"; do
  play=${pair%%=*}
  app=${pair#*=}
  if [ -z "$play" ] || [ "$app" = "$pair" ]; then
    echo "store capture: '$pair' is not <play>=<app>" >&2
    exit 2
  fi
  echo "store capture: $udid $play, app language $app"
  rm -rf "$out"
  mkdir -p "$out"
  pass light
  rm -rf "${dest:?}/$play"
  mkdir -p "$dest/$play"
  mv "$out"/*.png "$dest/$play"/
  if [ "$play" = "$web_locale" ]; then
    echo "store capture: $udid $play, dark theme"
    rm -rf "$out"
    mkdir -p "$out"
    pass dark
    mkdir -p "$dest/$play/dark"
    mv "$out"/*.png "$dest/$play/dark"/
  fi
done
ls "$dest"
