#!/bin/bash
# Frame histograms for four gestures on a signed-in library:
# `measure-gestures.sh OUT RUNS`, then `node scripts/lib/gesture-framestats.mjs OUT/*.txt`.
#
# The gestures are a feed scroll of about one screen height, an activity open
# from the feed, a tab switch from the feed to the map and a map pan. Each one
# resets `gfxinfo` just before it, reads `framestats` every half second while it
# runs, because a dump holds only the last 120 frames, and reads the summary
# histogram at the end, into OUT/<gesture>-<run>.txt.
#
# It never enters demo mode: the login screen ends the run, because the library
# on the handset is a real one and demo entry would replace its session. Every
# gesture is sent only with Veloq in front and the expected screen showing, and
# a run whose state is wrong afterwards is renamed .bad and not counted. The
# first round after launch is a warm-up and is written as run 0.
set -u

if [ $# -ne 2 ]; then
  echo "usage: $(basename "$0") OUT RUNS" >&2
  exit 2
fi

if [ -z "${VELOQ_DEVICE_LOCK_HELD:-}" ]; then
  exec "$(dirname "$0")/with-device-lock.sh" "$0" "$@"
fi

OUT=$1 RUNS=$2
PKG=com.veloq.app.dev
D=${VELOQ_DEVICE_SERIAL:-${ANDROID_SERIAL:-}}
if [ -z "$D" ]; then
  echo "measure-gestures: no handset attached, or none named." >&2
  exit 2
fi
READS=${READS:-6}
QUIET=${QUIET:-10}
mkdir -p "$OUT"

a() { adb -s "$D" "$@"; }

focused() { a shell dumpsys window 2>/dev/null | grep -q "mCurrentFocus.*$PKG/"; }

dump() {
  local n
  for n in 1 2 3 4 5; do
    if a shell uiautomator dump /sdcard/i-gest.xml 2>/dev/null | grep -q dumped; then
      a shell cat /sdcard/i-gest.xml 2>/dev/null
      return 0
    fi
    sleep 1
  done
  return 1
}

showing() { focused && dump | grep -q "resource-id=\"$1\""; }

centre_of() { # $1 an attribute match
  dump | tr '>' '\n' | grep -E "$1" | head -1 |
    sed -n 's/.*bounds="\[\([0-9]*\),\([0-9]*\)\]\[\([0-9]*\),\([0-9]*\)\]".*/\1 \2 \3 \4/p' |
    awk '{ printf "%d %d\n", ($1 + $3) / 2, ($2 + $4) / 2 }'
}

# The first feed card on its stats row, from a dump on stdin: the map preview
# takes the touch itself.
card_of() {
  tr '>' '\n' | grep -E 'resource-id="activity-card-' | grep -v 'activity-card-bottom' | head -1 |
    sed -n 's/.*bounds="\[\([0-9]*\),\([0-9]*\)\]\[\([0-9]*\),\([0-9]*\)\]".*/\1 \2 \3 \4/p' |
    awk '{ printf "%d %d\n", $1 + ($3 - $1) * 0.3, $4 - ($4 - $2) * 0.15 }'
}

# The card point once two dumps a second apart agree on it, with the feed
# showing in both. A list still moving after a swipe takes a tap as a stop
# rather than a press, so the open never happens.
settled_card_point() {
  local prev="" now xml n
  for n in 1 2 3 4 5 6 7 8 9 10; do
    focused && xml=$(dump) || return 1
    grep -q 'resource-id="home-screen"' <<<"$xml" || return 1
    now=$(card_of <<<"$xml")
    if [ -n "$now" ] && [ "$now" = "$prev" ]; then
      echo "$now"
      return 0
    fi
    prev=$now
    sleep 1
  done
  return 1
}

# A screen that may still be mounting: $1 the id, $2 the seconds to poll for.
appears() {
  local n
  for n in $(seq 1 "$2"); do
    showing "$1" && return 0
    sleep 1
  done
  showing "$1"
}

wait_quiet() {
  local calm=0 tries=0 pid cpu
  pid=$(a shell pidof "$PKG" | tr -d '\r')
  [ -n "$pid" ] || return 1
  while [ "$calm" -lt 3 ] && [ "$tries" -lt 90 ]; do
    tries=$((tries + 1))
    cpu=$(a shell top -b -n 1 -d 1 -p "$pid" 2>/dev/null | awk -v p="$pid" '$1 == p { print int($9) }')
    if [ -n "$cpu" ] && [ "$cpu" -lt "$QUIET" ]; then calm=$((calm + 1)); else calm=0; fi
    sleep 2
  done
  [ "$calm" -ge 3 ]
}

# Reset, run the gesture given as a device shell command, read framestats
# while it runs, then the summary. $1 the file, $2 the gesture.
capture() {
  a shell "dumpsys gfxinfo $PKG reset >/dev/null; $2; i=0; while [ \$i -lt $READS ]; do sleep 0.5; dumpsys gfxinfo $PKG framestats; i=\$((i + 1)); done; echo '=== SUMMARY'; dumpsys gfxinfo $PKG" >"$1" 2>&1
}

bad() { mv "$1" "${1%.txt}.bad"; echo "$(basename "$1"): $2" >&2; }

enter() {
  a shell am force-stop "$PKG" >/dev/null 2>&1
  a shell am start -n "$PKG/$PKG.MainActivity" >/dev/null 2>&1
  sleep 8
  if showing login-screen; then
    echo "the login screen is showing: not signed in, stopping" >&2
    exit 3
  fi
  wait_quiet || echo "the app did not go quiet" >&2
  sleep "${SETTLE:-20}"
  showing home-screen
}

W=$(a shell wm size | sed -n 's/.*: \([0-9]*\)x\([0-9]*\).*/\1/p' | tr -d '\r')
H=$(a shell wm size | sed -n 's/.*: \([0-9]*\)x\([0-9]*\).*/\2/p' | tr -d '\r')
CX=$((W / 2))
# Feed scroll: 77% to 21% of the height, about one screen of content.
FY0=$((H * 77 / 100)) FY1=$((H * 21 / 100))
# Map pan: right to left across the map's own centre, clear of the search
# sheet at the bottom and the button column at the right edge.
MY=$((H * 32 / 100)) MX0=$((W * 3 / 4)) MX1=$((W / 4))

installed() { a shell dumpsys package "$PKG" 2>/dev/null | grep -m1 lastUpdateTime | tr -d '\r '; }
BUILD=$(installed)
echo "timing the build installed at ${BUILD#lastUpdateTime=}, screen ${W}x${H}" >&2

enter || { echo "not on the feed after entry" >&2; exit 1; }

for run in $(seq 0 "$RUNS"); do
  if [ "$(installed)" != "$BUILD" ]; then
    echo "the build on the handset changed, stopping" >&2
    break
  fi

  f=$OUT/feed-scroll-$run.txt
  if showing home-screen; then
    capture "$f" "input swipe $CX $FY0 $CX $FY1 400"
    focused && showing home-screen || bad "$f" "feed not showing after the scroll"
    a shell input swipe "$CX" "$FY1" "$CX" "$FY0" 400
    sleep 2
  fi

  f=$OUT/activity-open-$run.txt
  if read -r x y < <(settled_card_point); then
    capture "$f" "input tap $x $y"
    if appears activity-detail-screen 4; then
      # Back from the feed would leave the app, so it goes only from the detail.
      a shell input keyevent KEYCODE_BACK
      sleep 3
    else
      bad "$f" "detail not showing after the tap"
    fi
  else
    echo "run $run: the feed did not settle, no activity open" >&2
  fi
  showing home-screen || { echo "run $run: not back on the feed" >&2; enter || exit 1; }

  f=$OUT/tab-switch-map-$run.txt
  read -r x y < <(centre_of 'content-desc="Map"')
  if [ -n "${x:-}" ]; then
    capture "$f" "input tap $x $y"
    showing map-screen || bad "$f" "map not showing after the tap"
  fi

  f=$OUT/map-pan-$run.txt
  if showing map-screen; then
    capture "$f" "input swipe $MX0 $MY $MX1 $MY 400"
    focused && showing map-screen || bad "$f" "map not showing after the pan"
    a shell input swipe "$MX1" "$MY" "$MX0" "$MY" 400
    sleep 2
  fi

  read -r x y < <(centre_of 'content-desc="Feed"')
  [ -n "${x:-}" ] && a shell input tap "$x" "$y"
  sleep 3
  showing home-screen || { echo "run $run: not back on the feed" >&2; enter || exit 1; }
done
a shell rm -f /sdcard/i-gest.xml
