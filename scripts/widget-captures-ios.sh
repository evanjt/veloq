#!/bin/sh
# Draw every iOS widget at every family from the engine's fixtures, and fail on cut-off text.
#
# Runs on a Mac with Xcode. The capture test runs from a Swift package of its own, written by
# scripts/write-widget-capture-package.mjs, on an iPhone simulator: the one named by
# WIDGET_CAPTURES_SIMULATOR (a udid), else the first available iPhone. The PNGs land in OUT,
# which CI uploads.
#
#   scripts/widget-captures-ios.sh [OUT]     # OUT defaults to widget-captures-ios/
set -eu

cd "$(dirname "$0")/.."

udid=${WIDGET_CAPTURES_SIMULATOR:-$(xcrun simctl list devices available |
  grep -m1 'iPhone' | sed -E 's/.*\(([A-F0-9-]+)\).*/\1/')}
if [ -z "$udid" ]; then
  echo "widget-captures-ios: no iPhone simulator is available" >&2
  exit 1
fi

# The simulator may be the one every session on the Mac shares, so the
# captures hold it while they run.
if [ "${VELOQ_SIM_LOCK_HELD:-}" != "$udid" ]; then
  WIDGET_CAPTURES_SIMULATOR=$udid
  export WIDGET_CAPTURES_SIMULATOR
  exec scripts/with-simulator-lock.sh "$udid" scripts/widget-captures-ios.sh "$@"
fi

out=${1:-widget-captures-ios}
rm -rf "$out"
mkdir -p "$out"
out=$(cd "$out" && pwd)

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
node scripts/write-widget-capture-package.mjs --out "$work/WidgetCaptures"

# xcodebuild hands a TEST_RUNNER_ variable to the test without the prefix.
status=0
(cd "$work/WidgetCaptures" &&
  TEST_RUNNER_WIDGET_CAPTURES_DIR="$out" xcodebuild test \
    -scheme WidgetCaptures-Package \
    -destination "id=$udid" \
    -derivedDataPath "$work/DerivedData") || status=$?
echo "widget-captures-ios: $(find "$out" -name '*.png' | wc -l | tr -d ' ') captures in $out"
exit "$status"
