#!/bin/bash
# Stage stamps for a 3D activity open: `measure-3d-open-stages.sh LABEL ROUNDS OUT`.
#
# Runs ROUNDS rounds in demo mode on the attached handset. Each round
# relaunches the app, enters demo, waits for the feed, then opens activity A
# cold, A again, B (another activity on the same ground) and B again, backing
# out between opens. The installed build must carry the page, component and
# native stage stamps, which print to logcat under `stamp3d` and
# `ReactNativeJS`: apply `measure/map3d-open-stages.stamps.patch` to the tree,
# build the debug APK, then revert it. The drop and take in that patch also end
# the view transition until the parent clears, which is the adoption fix under
# test; drop that hunk to measure the tree as it is. Each round's logcat is written to OUT/LABEL-<round>.log and
# read by `measure/map3d-open-stages.mjs`.
set -u

if [ $# -ne 3 ]; then
  echo "usage: $(basename "$0") LABEL ROUNDS OUT" >&2
  exit 2
fi

HERE=$(dirname "$0")
if [ -z "${VELOQ_DEVICE_LOCK_HELD:-}" ]; then
  exec "$HERE/with-device-lock.sh" "$0" "$@"
fi

LABEL=$1 ROUNDS=$2 OUT=$3
D=${VELOQ_DEVICE_SERIAL:-${ANDROID_SERIAL:-}}
if [ -z "$D" ]; then
  echo "measure-3d-open-stages: no handset attached, or none named." >&2
  exit 2
fi
PKG=com.veloq.app.dev
A=${FIRST:-demo-test-0}
B=${SECOND:-demo-test-7}
# Seconds an open is given before backing out.
DWELL=${DWELL:-14}
mkdir -p "$OUT"

a() { adb -s "$D" "$@"; }

ui() {
  a shell uiautomator dump /sdcard/i-3d.xml >/dev/null 2>&1 || return 1
  a shell cat /sdcard/i-3d.xml 2>/dev/null
}

# Prints "x y" for the centre of the first node whose attribute matches.
centre_of() {
  ui | tr '>' '\n' | grep -E "$1" | head -1 |
    sed -n 's/.*bounds="\[\([0-9]*\),\([0-9]*\)\]\[\([0-9]*\),\([0-9]*\)\]".*/\1 \2 \3 \4/p' |
    awk '{ print int(($1 + $3) / 2), int(($2 + $4) / 2) }'
}

tap_if() {
  local xy
  xy=$(centre_of "$1")
  [ -n "$xy" ] || return 1
  a shell input tap $xy
  return 0
}

wait_for() {
  local i=0
  while [ $i -lt "$2" ]; do
    if ui | grep -q "$1"; then return 0; fi
    sleep 1
    i=$((i + 1))
  done
  return 1
}

enter_demo() {
  a shell am force-stop "$PKG"
  sleep 2
  a logcat -c
  a shell am start -n "$PKG/$PKG.MainActivity" >/dev/null 2>&1
  if wait_for 'resource-id="login-screen"' 30; then
    tap_if 'resource-id="login-demo-button"' || return 1
  fi
  wait_for 'resource-id="home-screen"' 30 || return 1
  local i=0
  while [ $i -lt 6 ]; do
    tap_if 'text="Not Now"' || tap_if 'text="Done"' || tap_if 'text="Skip"' || tap_if 'text="Close"' || break
    sleep 2
    i=$((i + 1))
  done
  wait_for 'resource-id="home-screen"' 30 || return 1
  ui | grep -q 'resource-id="demo-mode-banner"' || return 1
  # The feed writes the previews the hero's poster reads.
  sleep 12
  return 0
}

open_activity() {
  a shell am start -W -a android.intent.action.VIEW -d "veloq://activity/$1" "$PKG" >/dev/null 2>&1
  sleep "$DWELL"
  a shell input keyevent 4
  sleep 6
}

r=1
while [ $r -le "$ROUNDS" ]; do
  echo "round $r: entering demo"
  if ! enter_demo; then
    echo "round $r: demo entry failed" >&2
    a logcat -d -v epoch > "$OUT/$LABEL-$r.failed.log" 2>/dev/null
    r=$((r + 1))
    continue
  fi
  # TOGGLE=1 opens A once first and taps the style toggle, so the later opens
  # run on the next style in the cycle; the page's build stamp names it.
  if [ "${TOGGLE:-0}" = "1" ]; then
    a shell am start -W -a android.intent.action.VIEW -d "veloq://activity/$A" "$PKG" >/dev/null 2>&1
    sleep 10
    tap_if 'resource-id="activity-map-style-toggle"' || echo "round $r: no style toggle" >&2
    sleep 10
    a shell input keyevent 4
    sleep 6
  fi
  for id in "$A" "$A" "$B" "$B"; do
    echo "round $r: opening $id"
    open_activity "$id"
  done
  a logcat -d -v epoch 2>/dev/null | grep -E 'stamp3d|START u0' > "$OUT/$LABEL-$r.log"
  echo "round $r: $(grep -c stamp3d "$OUT/$LABEL-$r.log") stamps"
  r=$((r + 1))
done
a shell am force-stop "$PKG"
