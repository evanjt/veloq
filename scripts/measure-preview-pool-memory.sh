#!/usr/bin/env bash
# Resident memory of the feed's preview snapshot pool, read per tab.
#
# The pool's pages live in the WebView renderer, a separate process from the
# app, so every reading takes two rows' worth of figures: the app's own
# `dumpsys meminfo` summary and the renderer's total PSS. The renderer is found
# through the service the app has bound, since its process name carries no
# package.
#
#   scripts/measure-preview-pool-memory.sh sweep <app-id> <label> <out.tsv>
#
# `sweep` relaunches the app on whatever session it holds (demo mode or a
# signed-in library), waits for the feed, scrolls it so previews are requested
# and drawn, then reads the feed, the map tab, the feed again and the
# fitness tab. Run it once per build under comparison; the map row is the one
# where the pool is hidden behind another tab. `METRO_PORT` names the bundler's
# host port when the build loads its JavaScript from one, and `SETTLE` the
# seconds to wait before each reading.
set -eu

if [ -z "${VELOQ_DEVICE_LOCK_HELD:-}" ]; then
  exec "$(dirname "$0")/with-device-lock.sh" "$0" "$@"
fi

HERE=$(cd "$(dirname "$0")" && pwd)
MODE=$1
APP=$2
LABEL=$3
OUT=$4
SETTLE=${SETTLE:-15}

renderer_pid() {
  adb shell dumpsys activity services "$APP" |
    grep -oE 'ProcessRecord\{[0-9a-f]+ [0-9]+:com\.google\.android\.webview:sandboxed_process[^ ]*' |
    head -1 | sed -E 's/.* ([0-9]+):.*/\1/'
}

pss_of() {
  adb shell dumpsys meminfo "$1" | awk '/TOTAL PSS:/ { for (i = 1; i <= NF; i++) if ($i ~ /^[0-9]+$/) { print $i; exit } }'
}

# The WebView objects attached to the activity's view tree, by identity, so two
# readings show whether a page survived the tab change or was built again. A
# page detached behind a frozen screen is absent here and still counted in the
# app's `WebViews` figure.
webview_ids() {
  adb shell dumpsys activity top | grep -oE '[A-Za-z]*WebView\{[0-9a-f]+' | sed 's/{/:/' | sort | paste -sd, -
}

# Connections from the device to the bundler; zero means the app is running
# the bundle embedded in its APK rather than the one under comparison.
bundler_links() {
  ss -tn | grep -c ":${METRO_PORT:-8081}" || true
}

reading() {
  local where=$1 raw pid rpss ids links
  ids=$(webview_ids)
  links=$(bundler_links)
  raw=$(adb shell dumpsys meminfo "$APP")
  pid=$(renderer_pid)
  rpss=
  [ -n "$pid" ] && rpss=$(pss_of "$pid")
  printf '%s\n' "$raw" | awk -v label="$LABEL" -v where="$where" -v rpid="$pid" -v rpss="$rpss" -v ids="$ids" -v links="$links" '
    function first(line,   n, f, i) { n = split(line, f, /[ \t]+/); for (i = 1; i <= n; i++) if (f[i] ~ /^[0-9]+$/) return f[i]; return "" }
    /^ +Native Heap +[0-9]/ { nh = first($0) }
    /^ +EGL mtrack +[0-9]/ { egl = first($0) }
    /^ +GL mtrack +[0-9]/ { gl = first($0) }
    /^ +Other dev +[0-9]/ { odev = first($0) }
    /^ +Graphics:/ { gs = first($0) }
    /^ +TOTAL PSS:/ { tp = first($0) }
    /WebViews:/ { n = split($0, f, /[ \t]+/); web = f[n] }
    END { printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n", label, where, tp, nh, gs, gl, egl, odev, web, rpid, rpss, links, ids }
  ' >>"$OUT"
  tail -1 "$OUT"
}

# A flow fails now and then on a transport hiccup rather than on the app, so
# each gets one retry before the sweep gives up.
maestro_run() {
  "$HERE/with-maestro.sh" --device "${ANDROID_SERIAL:?}" test -e APP_ID="$APP" "$@" >/dev/null 2>&1 ||
    "$HERE/with-maestro.sh" --device "${ANDROID_SERIAL:?}" test -e APP_ID="$APP" "$@" >/dev/null
}

tab() {
  local name=$1 screen=$2 flow
  flow=$(mktemp --suffix .yaml)
  printf 'appId: %s\n---\n- tapOn: %s\n- extendedWaitUntil:\n    visible:\n      id: %s\n    timeout: 30000\n' \
    "$APP" "'$name'" "'$screen'" >"$flow"
  maestro_run "$flow"
  rm -f "$flow"
  sleep "$SETTLE"
}

case "$MODE" in
  sweep)
    [ -s "$OUT" ] || printf 'label\twhere\tapp_total_pss\tnative_heap\tgraphics\tgl_mtrack\tegl_mtrack\tother_dev\twebviews\trenderer_pid\trenderer_pss\tbundler_links\twebview_ids\n' >"$OUT"
    adb shell am force-stop "$APP"
    flow=$(mktemp --suffix .yaml)
    printf 'appId: %s\n---\n- launchApp:\n    clearState: false\n- extendedWaitUntil:\n    visible:\n      id: home-screen\n    timeout: 120000\n- repeat:\n    times: 6\n    commands:\n      - swipe:\n          start: 50%%, 70%%\n          end: 50%%, 30%%\n          duration: 600\n      - waitForAnimationToEnd\n' "$APP" >"$flow"
    maestro_run "$flow"
    rm -f "$flow"
    sleep "$SETTLE"
    reading feed
    tab Map map-screen
    reading map
    tab Feed home-screen
    reading feed-again
    tab Fitness fitness-screen
    reading fitness
    ;;
  *)
    echo "unknown mode: $MODE" >&2
    exit 2
    ;;
esac
