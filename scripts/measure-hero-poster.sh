#!/bin/bash
# Time the activity hero from the tap to its first route pixels:
# `measure-hero-poster.sh LABEL APK ROUNDS OUT`.
#
# APK is a build whose JavaScript stamps the hero's stages into a text view
# with the testID `hero-stamps`, in milliseconds from the feed card's press:
# `render` (first render of the map view), `effect` (its first effect),
# `posterLoad` and `posterFrame` (the cached preview decoded, and the animation
# frame after it), `ready` and `readyFrame` (the map surface reporting ready,
# which is when it stops being transparent), and `memoUs` (microseconds spent
# looking the preview up during render). Release builds send nothing to
# logcat, so the stamps are read off the view tree with `uiautomator`.
#
# The library is the signed-in one already on the handset, so the APK must be
# signed with the key of the build installed there: `adb install -r` keeps the
# app's data only then.
#
# Each round relaunches the app, waits for it to go quiet, then opens card
# FIRST (cold: the first hero of the process), opens it again (warm), and opens
# card SECOND (second: another activity's first hero in the same process).
# Every open is read only with Veloq in front, before and after.
set -u

if [ $# -ne 4 ]; then
  echo "usage: $(basename "$0") LABEL APK ROUNDS OUT" >&2
  exit 2
fi

HERE=$(dirname "$0")
if [ -z "${VELOQ_DEVICE_LOCK_HELD:-}" ]; then
  exec "$HERE/with-device-lock.sh" "$0" "$@"
fi

LABEL=$1 APK=$2 ROUNDS=$3 OUT=$4
# The two feed cards to open, by activity id. Whether a hero opens in 3D is
# decided per activity, so pick them by what the stamps' `mode` reports.
FIRST=${FIRST:?FIRST is the activity id opened cold and warm}
SECOND=${SECOND:?SECOND is the activity id opened second}
D=${VELOQ_DEVICE_SERIAL:-${ANDROID_SERIAL:-}}
if [ -z "$D" ]; then
  echo "measure-hero-poster: no handset attached, or none named." >&2
  exit 2
fi
PKG=com.veloq.app.dev
# Seconds after the tap before the stamps are read. The surface takes up to
# about four seconds on ground whose imagery has to come over the network.
SETTLE=${SETTLE:-8}
QUIET=${QUIET:-10}
DUMP=/sdcard/hero-poster.xml
mkdir -p "$OUT"

a() { adb -s "$D" "$@"; }

focused() {
  a shell dumpsys window 2>/dev/null | grep -q "mCurrentFocus.*$PKG/"
}

dump() {
  a shell uiautomator dump "$DUMP" >/dev/null 2>&1 && a shell cat "$DUMP" 2>/dev/null | tr '>' '\n'
}

on_feed() {
  focused && dump | grep -q 'resource-id="home-screen"'
}

# A point on the stats row of feed card ID, scrolling down to it: the map
# preview fills the top of the card and takes the touch itself.
card_point() {
  local id=$1 tries=0 hit
  while [ "$tries" -lt "${SCROLLS:-12}" ]; do
    hit=$(dump | grep "resource-id=\"activity-card-$id-secondary-stats\"" | head -1 |
      sed -n 's/.*bounds="\[\([0-9]*\),\([0-9]*\)\]\[\([0-9]*\),\([0-9]*\)\]".*/\1 \2 \3 \4/p')
    if [ -n "$hit" ]; then
      echo "$hit" | awk '{ printf "%d %d\n", $1 + ($3 - $1) * 0.3, ($2 + $4) / 2 }'
      return 0
    fi
    a shell input swipe 540 1700 540 1100 400
    sleep 2
    tries=$((tries + 1))
  done
  return 1
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
  wait_quiet || echo "$LABEL app did not go quiet" >&2
  on_feed
}

# One open of card ID; prints the stamps line or fails with the state wrong.
open_once() {
  local id=$1 kind=$2 x y stamps
  on_feed || return 1
  read -r x y < <(card_point "$id") || return 1
  [ -n "$x" ] || return 1
  a shell input tap "$x" "$y"
  sleep "$SETTLE"
  focused || return 1
  stamps=$(dump | grep 'resource-id="hero-stamps"' | sed -n 's/.*text="HERO \([^"]*\)".*/\1/p' | head -1)
  focused || return 1
  a shell input keyevent KEYCODE_BACK >/dev/null 2>&1
  sleep 3
  [ -n "$stamps" ] || return 1
  echo "$LABEL $kind $stamps"
}

a install -r "$APK" >&2 || { echo "$LABEL INSTALL FAILED"; exit 1; }
for round in $(seq 1 "$ROUNDS"); do
  enter || { echo "$LABEL round $round: not on the feed after entry" >&2; continue; }
  open_once "$FIRST" cold || echo "$LABEL round $round cold: state wrong, discarded" >&2
  open_once "$FIRST" warm || echo "$LABEL round $round warm: state wrong, discarded" >&2
  open_once "$SECOND" second || echo "$LABEL round $round second: state wrong, discarded" >&2
done 2>&1 | tee -a "$OUT/$LABEL.txt"
a shell rm -f "$DUMP"
