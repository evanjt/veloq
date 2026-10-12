#!/usr/bin/env sh
# Open the app on its global crash screen, through the debug-only trigger.
#
#   scripts/force-render-crash.sh android [PACKAGE]
#   scripts/force-render-crash.sh ios [UDID|booted] [BUNDLE_ID]
#
# The root layout reads the request once, when it mounts, so the app is stopped
# first and launched cold. The request is spent on that launch, and the next
# launch opens normally. Only a debug native build carries the trigger: the
# receiver lives in the Android debug source set, and iOS reads the launch
# argument only in the Debug configuration. On a release build the app opens as
# usual.
#
# Android needs ANDROID_SERIAL. The broadcast carries FLAG_INCLUDE_STOPPED_PACKAGES
# (0x20), since a force-stopped app receives no broadcast otherwise. iOS runs on
# the Mac that hosts the simulator. From Maestro the same launch is
#
#   - launchApp:
#       arguments:
#         VeloqForceRenderCrash: true

set -eu

platform=${1:-}

case "$platform" in
  android)
    if [ -z "${VELOQ_DEVICE_LOCK_HELD:-}" ]; then
      exec "$(dirname "$0")/with-device-lock.sh" "$0" "$@"
    fi
    if [ -z "${ANDROID_SERIAL:-}" ]; then
      echo 'Set ANDROID_SERIAL to the device to crash' >&2
      exit 2
    fi
    package=${2:-com.veloq.app.dev}
    adb -s "$ANDROID_SERIAL" shell am force-stop "$package"
    adb -s "$ANDROID_SERIAL" shell am broadcast -f 0x20 \
      -n "$package/com.veloq.debugcrash.DebugCrashReceiver"
    adb -s "$ANDROID_SERIAL" shell monkey -p "$package" -c android.intent.category.LAUNCHER 1
    ;;
  ios)
    udid=${2:-booted}
    if [ -z "${VELOQ_SIM_LOCK_HELD:-}" ]; then
      exec "$(dirname "$0")/with-simulator-lock.sh" "$udid" "$0" "$@"
    fi
    bundle=${3:-com.veloq.app.dev}
    xcrun simctl terminate "$udid" "$bundle" 2>/dev/null || true
    xcrun simctl launch "$udid" "$bundle" -VeloqForceRenderCrash YES
    ;;
  *)
    echo 'Usage: force-render-crash.sh android [PACKAGE] | ios [UDID|booted] [BUNDLE_ID]' >&2
    exit 2
    ;;
esac
