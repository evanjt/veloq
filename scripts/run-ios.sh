#!/usr/bin/env sh
# Build and run the iOS app with the identity and compile mode named.
#
#   scripts/run-ios.sh dev metro          Veloq Dev, Debug, served by Metro
#   scripts/run-ios.sh dev standalone     Veloq Dev, Release, embedded JavaScript
#   scripts/run-ios.sh production         Veloq, which is only ever standalone
#
# A Metro build keeps running with the bundler, so its record is written after
# with `npm run ios:record`. A standalone build writes its record when it ends.
set -eu

cd "$(dirname "$0")/.."

usage() {
  echo "usage: scripts/run-ios.sh dev metro|standalone, or production [standalone]" >&2
  exit 2
}
case "${1:-} ${2:-}" in
"dev metro") configuration=Debug ;;
"dev standalone") configuration=Release ;;
"production " | "production standalone") configuration=Release ;;
*) usage ;;
esac
[ "$#" -le 2 ] || usage
APP_VARIANT=$1
export APP_VARIANT

node scripts/check-toolchain.mjs --platform ios
node scripts/prepare-native.mjs --platform ios
node scripts/build-record.js snapshot ios "$configuration"
if [ "$configuration" = Debug ]; then
  exec npx expo run:ios
fi
npx expo run:ios --configuration Release
node scripts/build-record.js write-ios Release
