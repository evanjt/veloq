#!/bin/bash
# The graphics the map tab leaves resident once another tab hides it, held
# under a ceiling: `measure-hidden-map-graphics.sh APP OUT BOUND_MB`.
#
# Run it on the S22 against a release build installed with
# `npm run install:android release`, signed in with a real library, before a
# release and after any change under `src/features/maps`. It is not CI: the
# figure is the handset's GPU driver's, and an emulator or a debug build reads
# a different one.
#
# Each of RUNS cold runs force-stops the app, opens it straight on the map with
# a `veloq://map` intent (Maestro's `launchApp` times out on the S22), waits
# SETTLE seconds and reads `dumpsys meminfo` with the map shown. It then taps
# the Insights tab, which hides the map tab rather than covering it with a
# stack screen, waits SETTLE seconds again and reads it hidden. Last it
# force-stops the app and opens it cold on Insights for a baseline that never
# opened the map.
#
# The hiding tab draws no WebView, so the hidden reading is the map's residue
# over that screen and nothing else. The feed is not a fit: its two terrain
# snapshot WebViews add their own GPU memory, and the map's WebView leaves the
# in-process GPU state larger after its own view is destroyed, which no trim
# the app receives in front gives back. The ceiling was taken behind a screen
# with no other map surface, and is held that way.
#
# A reading counts only with the app in front and the expected screen on it.
# The captures go to OUT/run<N>-shown.txt, OUT/run<N>-hidden.txt and
# OUT/run<N>-baseline.txt, and `lib/meminfo-summary.mjs` prints the table and
# the map's share over the baseline, and exits 1 when the median hidden
# Graphics is over BOUND_MB, 2 when fewer than three runs were read.
set -u

if [ $# -ne 3 ]; then
  echo "usage: $(basename "$0") APP OUT BOUND_MB" >&2
  exit 2
fi

HERE=$(dirname "$0")
if [ -z "${VELOQ_DEVICE_LOCK_HELD:-}" ]; then
  exec "$HERE/with-device-lock.sh" "$0" "$@"
fi

APP=$1 OUT=$2 BOUND=$3
D=${VELOQ_DEVICE_SERIAL:-${ANDROID_SERIAL:-}}
if [ -z "$D" ]; then
  echo "measure-hidden-map-graphics: no handset attached, or none named." >&2
  exit 2
fi
RUNS=${RUNS:-3}
SETTLE=${SETTLE:-25}
mkdir -p "$OUT"
rm -f "$OUT"/run*-shown.txt "$OUT"/run*-hidden.txt "$OUT"/run*-baseline.txt

a() { adb -s "$D" "$@"; }

focused() {
  a shell dumpsys window 2>/dev/null | grep -q "mCurrentFocus.*$APP/"
}

# uiautomator refuses while the screen keeps animating, so a dump is tried a
# few times before the state reads as wrong.
dump() {
  local n
  for n in 1 2 3 4 5; do
    if a shell uiautomator dump /sdcard/hidden-map.xml 2>/dev/null | grep -q dumped; then
      a shell cat /sdcard/hidden-map.xml 2>/dev/null
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

reading() {
  a shell dumpsys meminfo "$APP" >"$1"
}

focus_line() {
  a shell dumpsys window 2>/dev/null | grep -o 'mCurrentFocus=[^}]*'
}

# Another session can install over the build between runs, and the reading
# would then be of its build: the run stops when the install time moves.
installed() { a shell dumpsys package "$APP" 2>/dev/null | grep -m1 lastUpdateTime | tr -d '\r '; }
BUILD=$(installed)
if [ -z "$BUILD" ]; then
  echo "measure-hidden-map-graphics: $APP is not installed on $D" >&2
  exit 2
fi
echo "measure-hidden-map-graphics: reading the build installed at ${BUILD#lastUpdateTime=}" >&2

for run in $(seq 1 "$RUNS"); do
  if [ "$(installed)" != "$BUILD" ]; then
    echo "run $run: the build on the handset changed, stopping" >&2
    break
  fi
  a shell am force-stop "$APP" >/dev/null 2>&1
  a shell am start -a android.intent.action.VIEW -d veloq://map -p "$APP" >/dev/null 2>&1
  sleep "$SETTLE"
  if ! showing map-screen; then
    echo "run $run: not on the map after launch, $(focus_line)" >&2
    continue
  fi
  reading "$OUT/run$run-shown.txt"
  read -r x y < <(tab_point Insights) || true
  if [ -z "${x:-}" ]; then
    echo "run $run: no Insights tab on screen" >&2
    rm -f "$OUT/run$run-shown.txt"
    continue
  fi
  a shell input tap "$x" "$y" >/dev/null 2>&1
  sleep "$SETTLE"
  if ! showing routes-screen; then
    echo "run $run: not on Insights after the tap, $(focus_line)" >&2
    rm -f "$OUT/run$run-shown.txt"
    continue
  fi
  reading "$OUT/run$run-hidden.txt"
  a shell am force-stop "$APP" >/dev/null 2>&1
  a shell am start -a android.intent.action.VIEW -d veloq://insights -p "$APP" >/dev/null 2>&1
  sleep "$SETTLE"
  if ! showing routes-screen; then
    echo "run $run: not on Insights for the baseline, $(focus_line)" >&2
    continue
  fi
  reading "$OUT/run$run-baseline.txt"
done
a shell rm -f /sdcard/hidden-map.xml

shopt -s nullglob
files=("$OUT"/run*-shown.txt "$OUT"/run*-hidden.txt "$OUT"/run*-baseline.txt)
if [ ${#files[@]} -eq 0 ]; then
  echo "measure-hidden-map-graphics: no run was read" >&2
  exit 2
fi
node "$HERE/lib/meminfo-summary.mjs" "$BOUND" "${files[@]}" | tee "$OUT/table.tsv"
exit "${PIPESTATUS[0]}"
