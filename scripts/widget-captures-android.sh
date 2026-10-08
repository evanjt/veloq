#!/bin/sh
# Draw every Android widget at every size from the engine's fixtures, and fail on cut-off text.
#
# The capture test runs from the engine module's test APK through `am instrument` rather than
# Gradle's connected task, because that task uninstalls the APK when it finishes and takes the
# PNGs with it. They are pulled into OUT, which CI uploads.
#
#   ./gradlew :veloqrs:assembleDebugAndroidTest -PreactNativeArchitectures=<the device's ABI>
#   scripts/widget-captures-android.sh [OUT]     # OUT defaults to widget-captures/
set -eu

if [ -z "${VELOQ_DEVICE_LOCK_HELD:-}" ]; then
  exec "$(dirname "$0")/with-device-lock.sh" "$0" "$@"
fi

cd "$(dirname "$0")/.."
out=${1:-widget-captures}
apk=modules/veloqrs/android/build/outputs/apk/androidTest/debug/veloqrs-debug-androidTest.apk
pkg=com.veloq.test

if [ ! -f "$apk" ]; then
  echo "widget-captures: no test APK at $apk; build it with ./gradlew :veloqrs:assembleDebugAndroidTest" >&2
  exit 1
fi

adb install -r -t "$apk" >/dev/null
log=$(mktemp)
# `am instrument` exits 0 whatever the test did, so the verdict is read from its report.
adb shell am instrument -w -e class com.veloq.widget.WidgetCaptureTest \
  "$pkg/androidx.test.runner.AndroidJUnitRunner" >"$log" 2>&1 || true
rm -rf "$out"
mkdir -p "$out"
adb pull "/sdcard/Android/data/$pkg/files/widget-captures/." "$out" >/dev/null || true
cat "$log"
echo "widget-captures: $(find "$out" -name '*.png' | wc -l) captures in $out"
grep -q '^OK (' "$log"
