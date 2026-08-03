#!/bin/bash
# Raw store captures on a clean device: status bar demo mode, dark system
# chrome, then the Maestro flow, then restore. Maestro cannot set the status
# bar, so it happens here.
#
# Usage: scripts/store-capture.sh android|ios [simulator-udid]
set -e

PLATFORM="${1:?usage: store-capture.sh android|ios [udid]}"
UDID="${2:-booted}"
CLOCK="0941"
OUT_DIR="artifacts/store-capture"
RAW_DIR="artifacts/store/raw"

cd "$(dirname "$0")/.."
mkdir -p "$OUT_DIR"

if [ "$PLATFORM" = "android" ]; then
  echo "=== status bar ==="
  adb shell settings put global sysui_demo_allowed 1
  adb shell am broadcast -a com.android.systemui.demo -e command enter
  adb shell am broadcast -a com.android.systemui.demo -e command clock -e hhmm "$CLOCK"
  adb shell am broadcast -a com.android.systemui.demo -e command battery -e level 100 -e plugged false
  adb shell am broadcast -a com.android.systemui.demo -e command network -e wifi show -e level 4
  adb shell am broadcast -a com.android.systemui.demo -e command network -e mobile hide
  adb shell am broadcast -a com.android.systemui.demo -e command notifications -e visible false
  adb shell cmd uimode night yes

  echo "=== capture ==="
  maestro test .maestro/store-capture.yaml

  echo "=== restore ==="
  adb shell am broadcast -a com.android.systemui.demo -e command exit

  DEST="$RAW_DIR/android"
elif [ "$PLATFORM" = "ios" ]; then
  echo "=== status bar ==="
  xcrun simctl status_bar "$UDID" override \
    --time "9:41" --batteryState charged --batteryLevel 100 \
    --wifiMode active --wifiBars 3 --cellularMode notSupported

  echo "=== capture ==="
  maestro test .maestro/store-capture.yaml

  echo "=== restore ==="
  xcrun simctl status_bar "$UDID" clear

  # iPad captures land in raw/ipad; the caller passes the iPad simulator udid
  # on the second run.
  DEST="$RAW_DIR/ios"
  if [ "$UDID" = "booted" ]; then
    MATCH="$(xcrun simctl list devices booted)"
  else
    MATCH="$(xcrun simctl list devices | grep "$UDID")"
  fi
  if echo "$MATCH" | grep -qi ipad; then
    DEST="$RAW_DIR/ipad"
  fi
else
  echo "unknown platform: $PLATFORM" >&2
  exit 1
fi

echo "=== collect ==="
mkdir -p "$DEST"
mv "$OUT_DIR"/*.png "$DEST"/
ls "$DEST"

echo "=== next steps ==="
echo "Render composites:  npm run store:render"
echo "Review output:      artifacts/store/"
echo "Install to fastlane: npm run store:install"
