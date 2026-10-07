#!/bin/bash
# Time opening an activity from the feed: `measure-activity-open.sh LABEL APK ROUNDS WARM OUT`.
#
# Installs APK and runs ROUNDS rounds in demo mode, which reads the same
# engine as a signed-in library and starts no network sync under the timing. Each round relaunches the app, waits for it to go quiet, then
# opens the first feed card once cold and WARM times more, going back to the
# feed between opens. Every open is captured with `dumpsys gfxinfo framestats`
# from a reset just before the tap, written to OUT/LABEL-<round>-<open>.txt and
# read by `lib/activity-open-framestats.mjs`, which reports tap to the push's
# first frame, tap to the push settling and tap to the last frame.
#
# Screen recording cannot resolve this: `screenrecord` delivered about 11 frames
# a second on the handset, against a read measured at about 11 ms. Framestats
# carries the input handling and frame completion on one device clock.
#
# The open is timed only with Veloq in front, before and after: a dialog that
# takes focus takes the tap too, and the frames it renders read as a fast open.
set -u

if [ $# -ne 5 ]; then
  echo "usage: $(basename "$0") LABEL APK ROUNDS WARM OUT" >&2
  exit 2
fi

HERE=$(dirname "$0")
if [ -z "${VELOQ_DEVICE_LOCK_HELD:-}" ]; then
  exec "$HERE/with-device-lock.sh" "$0" "$@"
fi

LABEL=$1 APK=$2 ROUNDS=$3 WARM=$4 OUT=$5
D=${VELOQ_DEVICE_SERIAL:-${ANDROID_SERIAL:-}}
if [ -z "$D" ]; then
  echo "measure-activity-open: no handset attached, or none named." >&2
  exit 2
fi
PKG=com.veloq.app.dev
# Seconds of capture after the tap, read every half second because a dump
# holds only the last 120 frames, one second at 120 Hz.
READS=${READS:-8}
# The app is quiet when its CPU share stays under this for three readings.
QUIET=${QUIET:-10}
mkdir -p "$OUT"

a() { adb -s "$D" "$@"; }

focused() {
  a shell dumpsys window 2>/dev/null | grep -q "mCurrentFocus.*$PKG/"
}

on_feed() {
  focused && a shell uiautomator dump /sdcard/i-open.xml >/dev/null 2>&1 &&
    a shell cat /sdcard/i-open.xml 2>/dev/null | grep -q 'resource-id="home-screen"'
}

# The first feed card, low and to the left, on its stats row: the map preview
# fills the top of the card and takes the touch itself.
card_point() {
  a shell uiautomator dump /sdcard/i-open.xml >/dev/null 2>&1 || return 1
  a shell cat /sdcard/i-open.xml 2>/dev/null | tr '>' '\n' |
    grep -E 'resource-id="activity-card-' | grep -v 'activity-card-bottom' | head -1 |
    sed -n 's/.*bounds="\[\([0-9]*\),\([0-9]*\)\]\[\([0-9]*\),\([0-9]*\)\]".*/\1 \2 \3 \4/p' |
    awk '{ printf "%d %d\n", $1 + ($3 - $1) * 0.3, $4 - ($4 - $2) * 0.15 }'
}

wait_quiet() {
  local calm=0 tries=0 pid cpu
  pid=$(a shell pidof "$PKG" | tr -d '\r')
  [ -n "$pid" ] || return 1
  while [ "$calm" -lt 3 ] && [ "$tries" -lt 120 ]; do
    tries=$((tries + 1))
    cpu=$(a shell top -b -n 1 -d 1 -p "$pid" 2>/dev/null | awk -v p="$pid" '$1 == p { print int($9) }')
    if [ -n "$cpu" ] && [ "$cpu" -lt "$QUIET" ]; then calm=$((calm + 1)); else calm=0; fi
    sleep 2
  done
  [ "$calm" -ge 3 ]
}

enter() {
  a shell am force-stop "$PKG" >/dev/null 2>&1
  a shell am start -n "$PKG/$PKG.MainActivity" >/dev/null 2>&1
  sleep 8
  "$HERE/with-maestro.sh" --device "$D" test "$HERE/../.maestro/open/enter.yaml" >/dev/null 2>&1
  wait_quiet || echo "$LABEL app did not go quiet" >&2
  on_feed
}

# One open from the feed, captured; prints the file or fails with the state wrong.
open_once() {
  local file=$1 x y
  on_feed || return 1
  read -r x y < <(card_point) || return 1
  [ -n "$x" ] || return 1
  a shell "dumpsys gfxinfo $PKG reset >/dev/null; input tap $x $y; i=0; while [ \$i -lt $READS ]; do sleep 0.5; dumpsys gfxinfo $PKG framestats; i=\$((i + 1)); done" >"$file" 2>&1
  focused || return 1
  a shell input keyevent KEYCODE_BACK >/dev/null 2>&1
  sleep 3
  echo "$file"
}

a install -r "$APK" >&2 || { echo "$LABEL INSTALL FAILED"; exit 1; }
for round in $(seq 1 "$ROUNDS"); do
  enter || { echo "$LABEL round $round: not on the feed after entry" >&2; continue; }
  for n in $(seq 0 "$WARM"); do
    kind=warm
    [ "$n" -eq 0 ] && kind=cold
    open_once "$OUT/$LABEL-$kind-$round-$n.txt" >/dev/null || echo "$LABEL round $round open $n: state wrong, discarded" >&2
  done
done
a shell rm -f /sdcard/i-open.xml
echo "== $LABEL cold"
node "$HERE/lib/activity-open-framestats.mjs" "$OUT/$LABEL"-cold-*.txt
echo "== $LABEL warm"
node "$HERE/lib/activity-open-framestats.mjs" "$OUT/$LABEL"-warm-*.txt
