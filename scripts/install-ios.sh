#!/bin/bash
# Install an iOS app only when it is the build of the tree you are on.
#
# The same check `install-apk.sh` makes for Android, against the record
# `npm run ios:standalone` or `npm run ios:prod` (or `npm run ios:record` after
# `npm run ios`) writes beside the `.app` (`scripts/lib/build-record-ios.js`):
# the embedded bundle and the linked Rust archive must be the recorded ones, the
# recorded inputs must be the tree's, and the bundle identifier and platform
# must be the ones asked for.
#
# Each identity is its own Xcode project, so a Release build of both can sit in
# DerivedData at once. --identity picks the newest of the one asked for, never
# read from APP_VARIANT. Without it the newest build of either is installed.
#
#   scripts/install-ios.sh Release --identity dev      # booted simulator, newest Veloq Dev
#   scripts/install-ios.sh Release --identity production
#   scripts/install-ios.sh Release --app PATH.app
#   scripts/install-ios.sh Release --device UDID       # a device, through devicectl
#   scripts/install-ios.sh Release --stale             # install it anyway, knowingly
#
# Through npm the arguments follow `--`: `npm run install:ios -- Release --identity dev`.
set -eu

VARIANT=${1:-Release}
shift || true
ALLOW_STALE=0
DEVICE=booted
ON_DEVICE=0
ARGS=()
while [ "$#" -gt 0 ]; do
  case "$1" in
  --stale) ALLOW_STALE=1 ;;
  --device)
    [ "$#" -ge 2 ] || { echo "install-ios: --device needs a UDID" >&2; exit 2; }
    DEVICE=$2
    ON_DEVICE=1
    shift
    ;;
  --app | --bundle-id | --identity)
    [ "$#" -ge 2 ] || { echo "install-ios: $1 needs a value" >&2; exit 2; }
    # An identity it does not know is refused here, so --stale cannot carry it past.
    if [ "$1" = --identity ] && [ "$2" != dev ] && [ "$2" != production ]; then
      echo "install-ios: --identity $2 names no identity; use dev or production" >&2
      exit 2
    fi
    ARGS+=("$1" "$2")
    shift
    ;;
  *)
    echo "install-ios: unknown argument $1" >&2
    exit 2
    ;;
  esac
  shift
done

cd "$(dirname "$0")/.."

PLATFORM=iphonesimulator
if [ "$ON_DEVICE" -eq 1 ]; then PLATFORM=iphoneos; fi

# The path is read out of the same lookup the record check uses, so the app
# installed is the app that was verified.
APP=$(node scripts/build-record.js locate-ios "$VARIANT" ${ARGS[@]+"${ARGS[@]}"}) || exit 1

if ! node scripts/build-record.js verify-ios "$VARIANT" --platform "$PLATFORM" ${ARGS[@]+"${ARGS[@]}"} --app "$APP"; then
  if [ "$ALLOW_STALE" -eq 0 ]; then
    echo "install-ios: refusing, this app is not the build of the tree you are on" >&2
    echo "install-ios: rebuild it with npm run ios:standalone or npm run ios:prod, or pass --stale to install it anyway" >&2
    exit 1
  fi
  echo "install-ios: installing an unverified build because --stale was passed" >&2
fi

if [ "$ON_DEVICE" -eq 1 ]; then
  exec xcrun devicectl device install app --device "$DEVICE" "$APP"
fi
# Every session on the Mac shares the booted simulator, so an install waits its turn.
exec scripts/with-simulator-lock.sh "$DEVICE" xcrun simctl install "$DEVICE" "$APP"
