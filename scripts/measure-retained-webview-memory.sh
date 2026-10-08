#!/usr/bin/env bash
# Resident memory of a 3D map WebView kept mounted behind the app after the
# memory reclaimer released its map, against the same session with none kept.
#
#   scripts/measure-retained-webview-memory.sh background <app-id> <activity-id> <run-label> <out-dir>
#   scripts/measure-retained-webview-memory.sh covered <app-id> <activity-id> <run-label> <out-dir> <cover-activity-id>
#   scripts/measure-retained-webview-memory.sh bgcheck <app-id> <activity-id> <run-label> <out-dir>
#
# `background` runs three arms, each from a cold launch on whatever session the
# app holds:
#
#   retained  open the activity, switch to 3D, go home with the screen still
#             mounted, send TRIM_MEMORY_MODERATE so the reclaimer releases the
#             page's map, then come back so it rebuilds on the same WebView
#   none      the same, but back out of the activity before going home, so no
#             3D page is alive while hidden; then reopen it in 3D
#   flat      the same as retained but never switching to 3D, so the hidden
#             activity screen is counted without any 3D page
#
# The feed's preview pages make the app's PSS differ by hundreds of megabytes
# between cold launches, so `covered` holds one session still instead: it
# opens the activity in 3D, opens a second activity over it, then takes the
# hidden page from live, to released with the reclaimer's own script, to a
# blank document, two readings at each step. `bgcheck` reads the page's map
# every three seconds after the background trim, to show whether the
# reclaimer's release reaches a backgrounded page at all.
#
# Every reading takes the app's own `dumpsys meminfo` summary and the WebView
# renderer's total PSS, the renderer found through the service the app has
# bound. Each 3D page is identified through the WebView's DevTools socket, which
# a debuggable build exposes: the target id names the native WebView and
# `performance.timeOrigin` the document in it, so a release shows as no map in
# the same document and a rebuild as a new document in the same target.
# `SETTLE` is the seconds waited before each reading.
set -eu

if [ -z "${VELOQ_DEVICE_LOCK_HELD:-}" ]; then
  exec "$(dirname "$0")/with-device-lock.sh" "$0" "$@"
fi

HERE=$(cd "$(dirname "$0")" && pwd)
MODE=$1
APP=$2
ACTIVITY=$3
RUN=$4
OUT=$5
COVER=${6:-}
SETTLE=${SETTLE:-15}
PORT=${DEVTOOLS_PORT:-9280}
mkdir -p "$OUT"
TSV=$OUT/readings.tsv

renderer_pid() {
  adb shell dumpsys activity services "$APP" |
    grep -oE 'ProcessRecord\{[0-9a-f]+ [0-9]+:com\.google\.android\.webview:sandboxed_process[^ ]*' |
    head -1 | sed -E 's/.* ([0-9]+):.*/\1/'
}

pss_of() {
  adb shell dumpsys meminfo "$1" | awk '/TOTAL PSS:/ { for (i = 1; i <= NF; i++) if ($i ~ /^[0-9]+$/) { print $i; exit } }'
}

# One line per DevTools page: target id, whether it holds a map, the map's
# pitch, and when its document began. With a target prefix and an expression,
# runs the expression in that page instead.
pages() {
  local pid
  pid=$(adb shell pidof "$APP" | tr -d '\r')
  [ -n "$pid" ] || return 0
  adb forward "tcp:$PORT" "localabstract:webview_devtools_remote_$pid" >/dev/null
  python3 -I "$HERE/measure-retained-webview-pages.py" "$PORT" "$@" || true
  adb forward --remove "tcp:$PORT" >/dev/null 2>&1 || true
}

# The body of the reclaimer's release script, run in one page.
RELEASE='(function() { if (window.map) { try { window.map.remove(); } catch (e) {} window.map = null; } return "released"; })()'

page_ids() { pages | cut -d' ' -f1 | sort; }

reading() {
  local arm=$1 stage=$2 raw pid rpss pg
  sleep "$SETTLE"
  raw=$(adb shell dumpsys meminfo "$APP")
  printf '%s\n' "$raw" >"$OUT/$RUN-$arm-$stage.meminfo.txt"
  pid=$(renderer_pid)
  rpss=
  [ -n "$pid" ] && rpss=$(pss_of "$pid")
  pg=$(pages | paste -sd';' -)
  printf '%s\n' "$raw" | awk -v run="$RUN" -v arm="$arm" -v stage="$stage" -v t="$(date +%H:%M:%S)" \
    -v rpid="$pid" -v rpss="$rpss" -v pg="$pg" '
    function first(line,   n, f, i) { n = split(line, f, /[ \t]+/); for (i = 1; i <= n; i++) if (f[i] ~ /^[0-9]+$/) return f[i]; return "" }
    /^ +Native Heap +[0-9]/ { nh = first($0) }
    /^ +GL mtrack +[0-9]/ { gl = first($0) }
    /^ +EGL mtrack +[0-9]/ { egl = first($0) }
    /^ +Graphics:/ { gs = first($0) }
    /^ +TOTAL PSS:/ { tp = first($0) }
    /WebViews:/ { n = split($0, f, /[ \t]+/); web = f[n] }
    END { printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n", run, arm, stage, t, tp, nh, gs, gl, egl, web, rpid, rpss, pg }
  ' >>"$TSV"
  tail -1 "$TSV"
}

focused() {
  adb shell dumpsys window | grep -q "mCurrentFocus=.*$APP/"
}

# Taps the centre of the view carrying a test id, read from the live hierarchy.
tap_id() {
  local id=$1 bounds
  adb shell uiautomator dump /sdcard/retained-webview.xml >/dev/null
  bounds=$(adb shell cat /sdcard/retained-webview.xml | grep -oE "resource-id=\"$id\"[^>]*bounds=\"[^\"]+\"" | grep -oE '\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]' | head -1)
  adb shell rm -f /sdcard/retained-webview.xml
  [ -n "$bounds" ] || { echo "no view with id $id on screen" >&2; return 1; }
  set -- $(printf '%s' "$bounds" | tr '[],' '   ')
  adb shell input tap $((($1 + $3) / 2)) $((($2 + $4) / 2))
}

cold_launch() {
  adb shell am force-stop "$APP"
  sleep 2
  adb shell am start -W -n "$APP/.MainActivity" >/dev/null
  sleep 20
  focused || { echo "app is not in front after launch" >&2; exit 1; }
}

open_activity() {
  adb shell am start -W -a android.intent.action.VIEW -d "veloq://activity/$ACTIVITY" "$APP" >/dev/null
  sleep 10
  focused || { echo "app is not in front after the deep link" >&2; exit 1; }
}

go_home() { adb shell input keyevent KEYCODE_HOME; }
trim() { adb shell am send-trim-memory "$APP" MODERATE; }
foreground() {
  adb shell am start -W -n "$APP/.MainActivity" >/dev/null
  focused || { echo "app is not in front after returning" >&2; exit 1; }
}

[ -s "$TSV" ] || printf 'run\tarm\tstage\ttime\tapp_total_pss\tnative_heap\tgraphics\tgl_mtrack\tegl_mtrack\twebviews\trenderer_pid\trenderer_pss\tpages\n' >"$TSV"

case "$MODE" in
background)
  for arm in ${ARMS:-retained none flat}; do
    cold_launch
    reading "$arm" launched
    open_activity
    if [ "$arm" != flat ]; then
      tap_id activity-map-3d-toggle
      SETTLE=25 reading "$arm" open
    else
      reading "$arm" open
    fi
    if [ "$arm" = none ]; then
      adb shell input keyevent KEYCODE_BACK
      reading "$arm" left
    fi
    go_home
    reading "$arm" hidden
    trim
    reading "$arm" released
    foreground
    if [ "$arm" = none ]; then
      open_activity
      tap_id activity-map-3d-toggle
    fi
    SETTLE=25 reading "$arm" reopened
  done
  ;;
covered)
  [ -n "$COVER" ] || { echo "covered needs a second activity id" >&2; exit 2; }
  cold_launch
  before=$(page_ids)
  reading covered launched
  open_activity
  tap_id activity-map-3d-toggle
  SETTLE=25 reading covered open
  target=$(comm -13 <(printf '%s\n' "$before") <(page_ids) | head -1)
  [ -n "$target" ] || { echo "no new page after the 3D open" >&2; exit 1; }
  echo "3D page $target"
  ACTIVITY=$COVER open_activity
  reading covered live
  reading covered live
  pages "$target" "$RELEASE"
  reading covered released
  reading covered released
  pages "$target" 'location.replace("about:blank"); "blank"'
  reading covered blank
  reading covered blank
  ;;
bgcheck)
  cold_launch
  open_activity
  tap_id activity-map-3d-toggle
  sleep 25
  go_home
  sleep 5
  trim
  for i in 1 2 3 4 5 6 7 8 9 10; do
    printf 'background +%ss: %s\n' $((i * 3)) "$(pages | paste -sd';' -)"
    sleep 3
  done
  foreground
  for i in 1 2 3 4 5; do
    printf 'foreground +%ss: %s\n' $((i * 2)) "$(pages | paste -sd';' -)"
    sleep 2
  done
  ;;
*)
  echo "unknown mode: $MODE, expected background, covered or bgcheck" >&2
  exit 2
  ;;
esac
