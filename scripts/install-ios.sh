#!/bin/bash
# Install an iOS app only when it is the build of the tree you are on.
#
# The same check `install-apk.sh` makes for Android, against the record
# `npm run ios:prod` (or `npm run ios:record` after `npm run ios`) writes beside
# the `.app` (`scripts/lib/build-record-ios.js`): the embedded bundle and the
# linked Rust archive must be the recorded ones, the recorded inputs must be
# the tree's, and the bundle identifier and platform must be the ones asked for.
#
#   scripts/install-ios.sh Release                     # booted simulator, newest build
#   scripts/install-ios.sh Release --app PATH.app
#   scripts/install-ios.sh Release --device UDID       # a device, through devicectl
#   scripts/install-ios.sh Release --stale             # install it anyway, knowingly
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
  --app | --bundle-id)
    [ "$#" -ge 2 ] || { echo "install-ios: $1 needs a value" >&2; exit 2; }
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

# The record names the app, so the path is read back out of the same lookup
# the writer used rather than guessed here.
APP=""
for ((i = 0; i < ${#ARGS[@]}; i++)); do
  if [ "${ARGS[$i]}" = "--app" ]; then APP=${ARGS[$((i + 1))]}; fi
done

if ! node scripts/build-record.js verify-ios "$VARIANT" --platform "$PLATFORM" ${ARGS[@]+"${ARGS[@]}"}; then
  if [ "$ALLOW_STALE" -eq 0 ]; then
    echo "install-ios: refusing, this app is not the build of the tree you are on" >&2
    echo "install-ios: rebuild it with npm run ios:prod, or pass --stale to install it anyway" >&2
    exit 1
  fi
  echo "install-ios: installing an unverified build because --stale was passed" >&2
fi

if [ -z "$APP" ]; then
  APP=$(node -e "
    const fs = require('fs'), os = require('os'), path = require('path');
    const root = path.join(os.homedir(), 'Library/Developer/Xcode/DerivedData');
    const found = [];
    for (const p of fs.existsSync(root) ? fs.readdirSync(root) : []) {
      const products = path.join(root, p, 'Build/Products');
      if (!fs.existsSync(products)) continue;
      for (const t of fs.readdirSync(products)) {
        if (!t.startsWith('$VARIANT-iphone')) continue;
        for (const n of fs.readdirSync(path.join(products, t))) {
          if (n.endsWith('.app')) found.push(path.join(products, t, n));
        }
      }
    }
    found.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    process.stdout.write(found[0] || '');
  ")
fi
[ -n "$APP" ] || { echo "install-ios: no $VARIANT .app found" >&2; exit 1; }

if [ "$ON_DEVICE" -eq 1 ]; then
  exec xcrun devicectl device install app --device "$DEVICE" "$APP"
fi
exec xcrun simctl install "$DEVICE" "$APP"
