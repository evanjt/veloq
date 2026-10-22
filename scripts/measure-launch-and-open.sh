#!/bin/bash
# Time a cold launch to the feed, then an activity open from it, on a signed-in
# build: `measure-launch-and-open.sh LABEL PKG ROUNDS OUT`.
#
# Each round force-stops PKG, starts its main activity with `am start -W` and
# captures `dumpsys gfxinfo framestats` every half second for READS reads,
# written below the start report to OUT/LABEL-launch-<round>.txt and read by
# `lib/cold-launch-framestats.mjs`. Once the app is quiet it taps the first
# feed card and captures the open the same way, to OUT/LABEL-open-<round>.txt,
# read by `lib/activity-open-framestats.mjs`. Nothing inside the process is
# read, so two builds compare on one footing whether or not they carry engine
# timing. The handset's own clock carries every frame.
#
# A dialog that takes focus takes the tap too, so the first-run sheets are
# dismissed before a round and a round whose state is wrong is discarded.
set -u

if [ $# -ne 4 ]; then
  echo "usage: $(basename "$0") LABEL PKG ROUNDS OUT" >&2
  exit 2
fi

HERE=$(dirname "$0")
if [ -z "${VELOQ_DEVICE_LOCK_HELD:-}" ]; then
  exec "$HERE/with-device-lock.sh" "$0" "$@"
fi

LABEL=$1 PKG=$2 ROUNDS=$3 OUT=$4
D=${VELOQ_DEVICE_SERIAL:-${ANDROID_SERIAL:-}}
if [ -z "$D" ]; then
  echo "measure-launch-and-open: no handset attached, or none named." >&2
  exit 2
fi
# The activity class keeps the application id it was compiled under, which a
# renamed package does not change.
ACTIVITY=${ACTIVITY:-$PKG.MainActivity}
# Half-second reads after the start or the tap; a dump holds only the last 120
# frames, one second at 120 Hz.
READS=${READS:-16}
QUIET=${QUIET:-10}
mkdir -p "$OUT"

a() { adb -s "$D" "$@"; }

focused() {
  a shell dumpsys window 2>/dev/null | grep -q "mCurrentFocus.*$PKG/"
}

dump() {
  a shell uiautomator dump /sdcard/i-launch.xml >/dev/null 2>&1 &&
    a shell cat /sdcard/i-launch.xml 2>/dev/null | tr '>' '\n'
}

centre() {
  sed -n 's/.*bounds="\[\([0-9]*\),\([0-9]*\)\]\[\([0-9]*\),\([0-9]*\)\]".*/\1 \2 \3 \4/p' |
    head -1 | awk '{ printf "%d %d", ($1 + $3) / 2, ($2 + $4) / 2 }'
}

# First-run sheets and permission prompts, tapped away until none is left.
dismiss() {
  local tries=0 xy
  while [ "$tries" -lt 6 ]; do
    tries=$((tries + 1))
    xy=$(dump | grep -E 'text="(Skip|Not now|Not Now|Don.t allow|Done|Close|Got it|Later)"' | centre)
    [ -n "$xy" ] || return 0
    a shell input tap $xy
    sleep 2
  done
}

on_feed() {
  focused && dump | grep -q 'resource-id="home-screen"'
}

# The first feed card, at CARD_POINT, two fractions of its width and height.
# Which part of a card opens it differs by build: on one the stats row at the
# foot does and the map preview takes the touch itself, on another the preview
# opens it and the stats row does not, so the caller names the point.
CARD_POINT=${CARD_POINT:-0.3 0.85}
card_point() {
  dump | grep -E 'resource-id="activity-card-' | grep -v -E 'activity-card-(bottom|[^"]*-)' | head -1 |
    sed -n 's/.*bounds="\[\([0-9]*\),\([0-9]*\)\]\[\([0-9]*\),\([0-9]*\)\]".*/\1 \2 \3 \4/p' |
    awk -v p="$CARD_POINT" '{ split(p, q, " "); printf "%d %d\n", $1 + ($3 - $1) * q[1], $2 + ($4 - $2) * q[2] }'
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

# A start the system reports as anything but COLD found the process alive, so
# the capture is thrown away and the launch taken again, three times at most.
launch_once() {
  local file=$1 tries=0
  while [ "$tries" -lt 3 ]; do
    tries=$((tries + 1))
    a shell am force-stop "$PKG" >/dev/null 2>&1
    sleep 3
    a shell "am start -W -n $PKG/$ACTIVITY; i=0; while [ \$i -lt $READS ]; do sleep 0.5; dumpsys gfxinfo $PKG framestats; i=\$((i + 1)); done" >"$file" 2>&1
    grep -q 'LaunchState: COLD' "$file" && break
    echo "$LABEL: start was not cold, taken again" >&2
  done
  focused || return 1
  wait_quiet || echo "$LABEL app did not go quiet" >&2
  dismiss
  on_feed
}

open_once() {
  local file=$1 x y
  on_feed || return 1
  read -r x y < <(card_point) || return 1
  [ -n "$x" ] || return 1
  a shell "dumpsys gfxinfo $PKG reset >/dev/null; input tap $x $y; i=0; while [ \$i -lt $READS ]; do sleep 0.5; dumpsys gfxinfo $PKG framestats; i=\$((i + 1)); done" >"$file" 2>&1
  focused || return 1
  a shell input keyevent KEYCODE_BACK >/dev/null 2>&1
  sleep 3
}

for round in $(seq 1 "$ROUNDS"); do
  launch_once "$OUT/$LABEL-launch-$round.txt" || {
    echo "$LABEL round $round: not on the feed after launch, launch kept and open skipped" >&2
    continue
  }
  open_once "$OUT/$LABEL-open-$round.txt" || echo "$LABEL round $round open: state wrong" >&2
done
a shell am force-stop "$PKG" >/dev/null 2>&1
a shell rm -f /sdcard/i-launch.xml
echo "== $LABEL launch"
node "$HERE/lib/cold-launch-framestats.mjs" "$OUT/$LABEL"-launch-*.txt
echo "== $LABEL open"
node "$HERE/lib/activity-open-framestats.mjs" "$OUT/$LABEL"-open-*.txt
