#!/bin/bash
# Time a tab's first visit after a cold launch: `measure-tab-first-visit.sh LABEL TAB SCREEN ROUNDS OUT`.
#
# TAB is the tab button's accessibility label as the handset reads it
# ("Fitness"), SCREEN the testID the tab's screen carries ("fitness-screen").
# Each round force-stops the app, launches it, enters demo mode, waits for the
# app to go quiet and then SETTLE seconds more, and taps TAB from the feed: the
# first visit, which mounts the screen. It then goes back to the feed and taps
# TAB again: the screen is kept mounted, so that switch is the control that
# shows what a tap costs without the mount. Every tap is captured with
# `dumpsys gfxinfo framestats` from a reset just before it, written to
# OUT/LABEL-<first|again>-<round>.txt and read by `lib/tab-visit-framestats.mjs`.
#
# The tap is timed only with Veloq in front, before and after, and with SCREEN
# on screen after it: a dialog that takes focus takes the tap too.
set -u

if [ $# -ne 5 ]; then
  echo "usage: $(basename "$0") LABEL TAB SCREEN ROUNDS OUT" >&2
  exit 2
fi

HERE=$(dirname "$0")
if [ -z "${VELOQ_DEVICE_LOCK_HELD:-}" ]; then
  exec "$HERE/with-device-lock.sh" "$0" "$@"
fi

LABEL=$1 TAB=$2 SCREEN=$3 ROUNDS=$4 OUT=$5
D=${VELOQ_DEVICE_SERIAL:-${ANDROID_SERIAL:-}}
if [ -z "$D" ]; then
  echo "measure-tab-first-visit: no handset attached, or none named." >&2
  exit 2
fi
PKG=${PKG:-com.veloq.app.dev}
# Seconds of capture after the tap, read every half second because a dump
# holds only the last 120 frames, one second at 120 Hz.
READS=${READS:-8}
QUIET=${QUIET:-10}
SETTLE=${SETTLE:-30}
mkdir -p "$OUT"
command -v maestro >/dev/null || PATH="$HOME/.maestro/bin:$PATH"

a() { adb -s "$D" "$@"; }

focused() {
  a shell dumpsys window 2>/dev/null | grep -q "mCurrentFocus.*$PKG/"
}

# uiautomator refuses while the screen keeps animating, as it does through the
# launch sync, so a dump is tried a few times before the state reads as wrong.
dump() {
  local n
  for n in 1 2 3 4 5; do
    if a shell uiautomator dump /sdcard/i-tab.xml 2>/dev/null | grep -q dumped; then
      a shell cat /sdcard/i-tab.xml 2>/dev/null
      return 0
    fi
    sleep 1
  done
  return 1
}

showing() {
  focused && dump | grep -q "resource-id=\"$1\""
}

# The centre of the tab button whose accessibility label is $1.
tab_point() {
  dump | tr '>' '\n' | grep -E "content-desc=\"$1\"" | head -1 |
    sed -n 's/.*bounds="\[\([0-9]*\),\([0-9]*\)\]\[\([0-9]*\),\([0-9]*\)\]".*/\1 \2 \3 \4/p' |
    awk '{ printf "%d %d\n", ($1 + $3) / 2, ($2 + $4) / 2 }'
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
  sleep "$SETTLE"
  showing home-screen
}

# One tap on TAB, captured; fails with the state wrong.
visit() {
  local file=$1 x y
  read -r x y < <(tab_point "$TAB") || return 1
  [ -n "$x" ] || return 1
  a shell "dumpsys gfxinfo $PKG reset >/dev/null; input tap $x $y; i=0; while [ \$i -lt $READS ]; do sleep 0.5; dumpsys gfxinfo $PKG framestats; i=\$((i + 1)); done" >"$file" 2>&1
  showing "$SCREEN"
}

back_to_feed() {
  local x y
  read -r x y < <(tab_point Feed) || return 1
  a shell input tap "$x" "$y" >/dev/null 2>&1
  sleep 3
  showing home-screen
}

# Another session can install over the build between rounds, and the timing
# would then be of its build: the run stops when the install time moves.
installed() { a shell dumpsys package "$PKG" 2>/dev/null | grep -m1 lastUpdateTime | tr -d '\r '; }
BUILD=$(installed)
echo "$LABEL timing the build installed at ${BUILD#lastUpdateTime=}" >&2

for round in $(seq 1 "$ROUNDS"); do
  if [ "$(installed)" != "$BUILD" ]; then
    echo "$LABEL round $round: the build on the handset changed, stopping" >&2
    break
  fi
  enter || { echo "$LABEL round $round: not on the feed after entry, focus $(a shell dumpsys window 2>/dev/null | grep -o 'mCurrentFocus=[^}]*')" >&2; continue; }
  visit "$OUT/$LABEL-first-$round.txt" || { echo "$LABEL round $round: first visit, state wrong, discarded" >&2; mv "$OUT/$LABEL-first-$round.txt" "$OUT/$LABEL-first-$round.bad" 2>/dev/null; continue; }
  back_to_feed || { echo "$LABEL round $round: not back on the feed" >&2; continue; }
  visit "$OUT/$LABEL-again-$round.txt" || { echo "$LABEL round $round: second visit, state wrong, discarded" >&2; mv "$OUT/$LABEL-again-$round.txt" "$OUT/$LABEL-again-$round.bad" 2>/dev/null; }
done
a shell rm -f /sdcard/i-tab.xml
echo "== $LABEL first visit"
node "$HERE/lib/tab-visit-framestats.mjs" "$OUT/$LABEL"-first-*.txt
echo "== $LABEL second visit"
node "$HERE/lib/tab-visit-framestats.mjs" "$OUT/$LABEL"-again-*.txt
