#!/bin/bash
# Frame times while panning the map tab: `measure-map-pan.sh LABEL RUNS`.
#
# The camera is set by hand before this runs, to the zoom and place being
# measured, and this only pans and reads. Each run resets `gfxinfo`, makes a
# fixed set of pans that come back to where they started, and reads the
# histogram back. A run where Veloq was not in front before and after is
# discarded, since another app's frames are not counted and a dialog's are.
set -u

if [ -z "${VELOQ_DEVICE_LOCK_HELD:-}" ]; then
  exec "$(dirname "$0")/with-device-lock.sh" "$0" "$@"
fi

D=${VELOQ_DEVICE_SERIAL:-${ANDROID_SERIAL:-}}
if [ -z "$D" ]; then
  echo "measure-map-pan: no handset attached, or none named." >&2
  exit 2
fi
PKG=com.veloq.app.dev
STEPS=${STEPS:-12}
# `swipe` is a finger's stream of moves, released at speed so the map flings,
# and the settle lets each fling stop before the reverse swipe. `drag` steps
# at the rate `input` can be spawned, about 16 Hz, which no finger does, so it
# reads every redraw as a separate frame started off the vsync.
MODE=${MODE:-swipe}
SWIPE_MS=${SWIPE_MS:-400}
SETTLE_S=${SETTLE_S:-2}
# The map tab's search sheet covers the bottom of the screen, so the pans are
# centred on the map's own centre, this far down the screen, not the screen's.
MAP_CY_PCT=${MAP_CY_PCT:-32}

focused() {
  adb -s "$D" shell dumpsys window 2>/dev/null | grep -q "mCurrentFocus.*$PKG/"
}

# One pan from (x0,y0) to (x1,y1). In `drag` mode it is held still before it
# lifts, so it has no velocity left to fling with.
drag() {
  local x0=$1 y0=$2 x1=$3 y1=$4 i cmd
  if [ "$MODE" = swipe ]; then
    adb -s "$D" shell input swipe "$x0" "$y0" "$x1" "$y1" "$SWIPE_MS"
    sleep "$SETTLE_S"
    return
  fi
  cmd="input motionevent DOWN $x0 $y0"
  for i in $(seq 1 "$STEPS"); do
    cmd="$cmd; input motionevent MOVE $((x0 + (x1 - x0) * i / STEPS)) $((y0 + (y1 - y0) * i / STEPS))"
  done
  cmd="$cmd; sleep 0.3; input motionevent MOVE $x1 $y1; input motionevent UP $x1 $y1"
  adb -s "$D" shell "$cmd"
}

# Right, left, down, up: each pair returns the camera to where it began. The
# pans stay clear of the map's button column at the right edge: a drag that
# starts on a button moves nothing while its reverse pans the map, and the
# camera walks off the ground being measured one pan width every cycle.
pan() {
  local w h cx cy dx dy
  read -r w h < <(adb -s "$D" shell wm size | sed -n 's/.*: \([0-9]*\)x\([0-9]*\).*/\1 \2/p')
  cx=$((w / 2)); cy=$((h * MAP_CY_PCT / 100)); dx=$((w / 4)); dy=$((h / 6))
  for _ in 1 2 3; do
    drag $((cx + dx)) "$cy" $((cx - dx)) "$cy"
    drag $((cx - dx)) "$cy" $((cx + dx)) "$cy"
    drag "$cx" $((cy + dy)) "$cx" $((cy - dy))
    drag "$cx" $((cy - dy)) "$cx" $((cy + dy))
  done
}

one() {
  focused || return 1
  adb -s "$D" shell dumpsys gfxinfo "$PKG" reset >/dev/null 2>&1
  pan
  sleep 1
  focused || return 1
  adb -s "$D" shell dumpsys gfxinfo "$PKG" 2>/dev/null | tr -d '\r' | sed -n \
    -e 's/^Total frames rendered: /frames=/p' \
    -e 's/^Janky frames: /janky=/p' \
    -e 's/^Number Frame deadline missed: /deadline_missed=/p' \
    -e 's/^\(50\|90\|95\|99\)th percentile: /p\1=/p' \
    -e 's/^Number Slow UI thread: /slow_ui=/p' \
    -e 's/^Number Slow issue draw commands: /slow_draw=/p' \
    | paste -sd' '
}

if [ $# -ne 2 ]; then
  echo "usage: $(basename "$0") LABEL RUNS" >&2
  exit 2
fi

label=$1
for i in $(seq 1 "$2"); do
  if line=$(one); then
    echo "$label $i $line"
  else
    echo "$label $i discarded: Veloq not in front"
  fi
done
