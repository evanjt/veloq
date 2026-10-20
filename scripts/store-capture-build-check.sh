#!/usr/bin/env sh
# Refuse a store capture when the installed build is a dev build.
#
#   scripts/store-capture-build-check.sh android
#   scripts/store-capture-build-check.sh ios <udid>
#
# A dev build draws its LogBox toasts over the bottom of the screen, and a
# capture taken on one carries them into the listing shots. The app checked is
# the one .maestro/store-capture.yaml launches. On Android a debuggable package
# is refused; on iOS an app with no embedded main.jsbundle, which is a build
# that loads its JavaScript from Metro. Run from the capture scripts it reads
# under the lock they hold; run alone it takes the device or simulator lock.

set -eu

usage() {
  echo "usage: scripts/store-capture-build-check.sh android | ios <udid>" >&2
  exit 2
}

here=$(cd "$(dirname "$0")" && pwd)
flow="$here/../.maestro/store-capture.yaml"
app=$(sed -n -E 's/^appId:[[:space:]]*([^[:space:]]+).*/\1/p' "$flow" | head -n 1)
if [ -z "$app" ]; then
  echo "store capture: no appId in $flow" >&2
  exit 1
fi

[ "$#" -ge 1 ] || usage
case "$1" in
  android)
    [ "$#" -eq 1 ] || usage
    if [ -z "${VELOQ_DEVICE_LOCK_HELD:-}" ]; then
      exec "$here/with-device-lock.sh" "$0" "$@"
    fi
    package=$(adb shell dumpsys package "$app")
    if ! printf '%s\n' "$package" | grep -q "Package \[$app\]"; then
      echo "store capture: $app is not installed. Install a release build first." >&2
      exit 1
    fi
    if printf '%s\n' "$package" | grep -E '^[[:space:]]*(pkg)?[Ff]lags=\[' | grep -qw DEBUGGABLE; then
      echo "store capture: $app is a debuggable build, whose warning toasts reach the shots." >&2
      echo "Install a release build of $app and run again." >&2
      exit 1
    fi
    ;;
  ios)
    [ "$#" -eq 2 ] || usage
    if [ -z "${VELOQ_SIM_LOCK_HELD:-}" ]; then
      exec "$here/with-simulator-lock.sh" "$2" "$0" "$@"
    fi
    if ! container=$(xcrun simctl get_app_container "$2" "$app" app 2>/dev/null) ||
      [ -z "$container" ]; then
      echo "store capture: $app is not installed on $2. Install a release build first." >&2
      exit 1
    fi
    if [ ! -f "$container/main.jsbundle" ]; then
      echo "store capture: $container has no main.jsbundle, so it is a dev build whose" >&2
      echo "warning toasts reach the shots. Install a release build of $app and run again." >&2
      exit 1
    fi
    ;;
  *) usage ;;
esac
