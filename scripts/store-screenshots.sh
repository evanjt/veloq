#!/usr/bin/env sh
# Both stores' screenshots in one run, from the demo library, in the light
# theme and every store language:
#
#   npm run store:screenshots [-- --only android|ios] [<play locale> ...]
#
# 1. Android captures on the attached test handset or emulator
#    (scripts/store-capture.sh, through scripts/with-maestro.sh).
# 2. iPhone and iPad captures on a Mac's simulators (scripts/store-capture-ios.sh).
# 3. The compositor frames every capture on the day palette
#    (scripts/store-screenshots.ts) and installs the sets into
#    config/fastlane: metadata/android/<locale>/images/phoneScreenshots/ and
#    screenshots/<locale>/, replacing each locale's set whole.
# 4. A full run then validates the trees, sizes and counts included.
#
# The raw captures stay in artifacts/store/raw/, which git ignores. --only
# reruns one platform's captures and sets; locales narrow every step to those.
#
# Each device needs a release build of the app installed and no session signed
# in. The iOS side reads:
#   VELOQ_IOS_PHONE  udid of a 6.9-inch iPhone simulator (1320x2868 shots)
#   VELOQ_IOS_IPAD   udid of a 13-inch iPad simulator (2064x2752 shots)
#   VELOQ_IOS_HOST   ssh host of the Mac holding them. Unset, they run here,
#                    which needs xcrun.
#   VELOQ_IOS_DIR    directory on that host the capture files are copied to,
#                    relative to its home (default veloq-store-capture)

set -eu

here=$(cd "$(dirname "$0")" && pwd)
cd "$here/.."

only=all
while [ "$#" -gt 0 ]; do
  case "$1" in
    --only)
      [ "$#" -ge 2 ] || { echo "store screenshots: --only needs android or ios" >&2; exit 2; }
      only=$2
      shift 2
      ;;
    --*)
      echo "store screenshots: unknown option $1" >&2
      exit 2
      ;;
    *) break ;;
  esac
done
case "$only" in
  all | android | ios) ;;
  *)
    echo "store screenshots: --only takes android or ios, not $only" >&2
    exit 2
    ;;
esac

all_pairs=$(npx --no-install tsx scripts/store-locales.ts capture 2>/dev/null)
[ -n "$all_pairs" ] || { echo "store screenshots: no capture locales" >&2; exit 1; }
pairs=""
if [ "$#" -eq 0 ]; then
  pairs=$all_pairs
else
  for locale in "$@"; do
    pair=$(printf '%s\n' "$all_pairs" | grep "^$locale=" || true)
    if [ -z "$pair" ]; then
      echo "store screenshots: $locale is not a captured locale:" $(printf '%s\n' "$all_pairs" | cut -d= -f1) >&2
      exit 2
    fi
    pairs="$pairs $pair"
  done
fi

ios_ready() {
  missing=""
  [ -n "${VELOQ_IOS_PHONE:-}" ] || missing="$missing VELOQ_IOS_PHONE"
  [ -n "${VELOQ_IOS_IPAD:-}" ] || missing="$missing VELOQ_IOS_IPAD"
  if [ -n "$missing" ]; then
    echo "store screenshots: the iOS captures need$missing, the udid of a 6.9-inch iPhone" >&2
    echo "and a 13-inch iPad simulator holding a release build. --only android skips them." >&2
    exit 2
  fi
  if [ -z "${VELOQ_IOS_HOST:-}" ] && ! command -v xcrun >/dev/null 2>&1; then
    echo "store screenshots: no xcrun here, so the iOS captures need VELOQ_IOS_HOST, the ssh" >&2
    echo "host of the Mac holding the simulators. --only android skips them." >&2
    exit 2
  fi
}

# The files a capture on the Mac runs, each copied to its own path there.
IOS_FILES="scripts/store-capture-ios.sh scripts/store-capture-build-check.sh
scripts/with-simulator-lock.sh .maestro/store-capture.yaml .maestro/helpers"

capture_ios() {
  udid=$1
  if [ -z "${VELOQ_IOS_HOST:-}" ]; then
    # shellcheck disable=SC2086
    scripts/store-capture-ios.sh "$udid" $pairs
    return
  fi
  host=$VELOQ_IOS_HOST
  dir=${VELOQ_IOS_DIR:-veloq-store-capture}
  ssh "$host" "mkdir -p '$dir'"
  # shellcheck disable=SC2086
  rsync -aR --delete $IOS_FILES "$host:$dir/"
  # shellcheck disable=SC2086
  ssh "$host" "cd '$dir' && rm -rf artifacts/store/raw && scripts/store-capture-ios.sh '$udid' $pairs"
  for platform in ios ipad; do
    if ssh "$host" "test -d '$dir/artifacts/store/raw/$platform'"; then
      mkdir -p "artifacts/store/raw/$platform"
      rsync -a "$host:$dir/artifacts/store/raw/$platform/" "artifacts/store/raw/$platform/"
    fi
  done
}

locales=$(for pair in $pairs; do printf '%s ' "${pair%%=*}"; done)

[ "$only" = android ] || ios_ready
if [ "$only" != ios ]; then
  # shellcheck disable=SC2086
  scripts/store-capture.sh android $pairs
fi
if [ "$only" != android ]; then
  capture_ios "$VELOQ_IOS_PHONE"
  capture_ios "$VELOQ_IOS_IPAD"
fi

render() {
  # shellcheck disable=SC2086
  npx --no-install tsx scripts/store-screenshots.ts --palette day --target "$1" $locales
}
case "$only" in
  all) render all ;;
  android) render play && render feature ;;
  ios) render appstore && render ipad ;;
esac
# shellcheck disable=SC2086
npx --no-install tsx scripts/store-screenshots.ts --install $locales

if [ "$only" = all ] && [ "$#" -eq 0 ]; then
  npx --no-install tsx scripts/validate-store-metadata.ts --require-screenshots
fi
