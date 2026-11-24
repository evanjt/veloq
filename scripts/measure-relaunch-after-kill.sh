#!/usr/bin/env bash
# measure-relaunch-after-kill.sh - Time what the feed shows after the app is
# killed and relaunched, read from the screen and from logcat.
#
# Usage, with ANDROID_SERIAL exported first:
#   scripts/measure-relaunch-after-kill.sh focus          # the window in front
#   scripts/measure-relaunch-after-kill.sh ids            # resource ids on screen, counted
#   scripts/measure-relaunch-after-kill.sh tap ID         # tap the centre of a test id
#   scripts/measure-relaunch-after-kill.sh signin         # API key sign-in from .env
#   scripts/measure-relaunch-after-kill.sh wait-feed [S]  # poll until the cards are filled
#   scripts/measure-relaunch-after-kill.sh debug-on       # unlock and switch Debug Mode on
#   scripts/measure-relaunch-after-kill.sh widen          # widen the sync range to the oldest
#   scripts/measure-relaunch-after-kill.sh wal            # the -wal size in bytes
#   scripts/measure-relaunch-after-kill.sh kill-mid-sync  # pull to refresh, then force-stop
#   scripts/measure-relaunch-after-kill.sh relaunch LABEL # force-stop, launch, sample the feed
#   scripts/measure-relaunch-after-kill.sh dashboard LABEL# read the FFI table and the timeline
#
# Samples and logs go under $OUT (default /tmp/relaunch-measure). Every screen
# read checks that the app under test is the window in front first, and refuses
# otherwise: the text of another app is never read.
set -euo pipefail
if [ -z "${VELOQ_DEVICE_LOCK_HELD:-}" ]; then
  exec "$(dirname "$0")/with-device-lock.sh" "$0" "$@"
fi

APP_ID="${APP_ID:-com.veloq.app.dev}"
OUT="${OUT:-/tmp/relaunch-measure}"
ENV_FILE="${ENV_FILE:-$(git rev-parse --show-toplevel)/../.env}"
mkdir -p "$OUT"

now_ms() { date +%s%3N; }

focus() { adb shell dumpsys window 2>/dev/null | grep -m1 mCurrentFocus | tr -d '\r'; }

require_front() {
  local f
  f=$(focus)
  case "$f" in
  *"$APP_ID"*) ;;
  *)
    echo "refused: the window in front is not the app under test: $f" >&2
    exit 3
    ;;
  esac
}

# The hierarchy as one line of XML on stdout. uiautomator waits for the window
# to go idle and a shimmer never does, so the dump is bounded by a timeout.
dump() {
  require_front
  adb exec-out sh -c 'uiautomator dump /sdcard/.relaunch.xml >/dev/null 2>&1 && cat /sdcard/.relaunch.xml; rm -f /sdcard/.relaunch.xml' 2>/dev/null | tr -d '\r'
}

count_id() { grep -o "resource-id=\"$1[^\"]*\"" | wc -l; }

# Centre of the first node carrying the id, as "x y".
bounds_of() {
  local id="$1" xml="$2"
  echo "$xml" | grep -oE "<node[^>]*resource-id=\"$id\"[^>]*>" | head -1 |
    grep -oE 'bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' |
    sed -E 's/bounds="\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\]"/\1 \2 \3 \4/' |
    awk '{ printf "%d %d\n", ($1+$3)/2, ($2+$4)/2 }'
}

tap_id() {
  local id="$1" xml c
  xml=$(dump)
  c=$(bounds_of "$id" "$xml")
  if [ -z "$c" ]; then
    echo "no node with id $id on screen" >&2
    return 1
  fi
  # shellcheck disable=SC2086
  adb shell input tap $c
  echo "tapped $id at $c"
}

ids() {
  dump | grep -oE 'resource-id="[^"]+"' | sort | uniq -c | sort -rn
}

launch() {
  adb shell am start -W -n "$APP_ID/.MainActivity" 2>&1 | tr -d '\r' | grep -E 'TotalTime|WaitTime|Status' || true
}

open_link() {
  adb shell am start -a android.intent.action.VIEW -d "$1" "$APP_ID" >/dev/null 2>&1
}

wal_size() {
  adb shell run-as "$APP_ID" ls -l files/ 2>/dev/null | tr -d '\r' | awk '/routes.db-wal$/ { print $5 }'
}

# One line per sample: elapsed ms, skeleton cards, ready previews, summary
# skeleton, summary hero, first-sync panel, login screen.
sample_line() {
  local t0="$1" xml
  xml=$(dump 2>/dev/null || true)
  local el=$(( $(now_ms) - t0 ))
  if [ -z "$xml" ]; then
    echo "$el dump-failed"
    return
  fi
  printf '%d skeleton=%d ready=%d summary-skeleton=%d summary-hero=%d first-sync=%d login=%d cards=%d\n' \
    "$el" \
    "$(echo "$xml" | count_id activity-card-skeleton\")" \
    "$(echo "$xml" | count_id activity-map-preview-ready-)" \
    "$(echo "$xml" | count_id summary-card-skeleton)" \
    "$(echo "$xml" | count_id summary-card-hero)" \
    "$(echo "$xml" | count_id feed-first-sync-)" \
    "$(echo "$xml" | count_id login-screen)" \
    "$(echo "$xml" | count_id activity-card-bottom)"
}

wait_feed() {
  local limit="${1:-600}" t0 line
  t0=$(now_ms)
  while :; do
    line=$(sample_line "$t0")
    echo "$line"
    case "$line" in
    *"skeleton=0 ready="[1-9]*"summary-skeleton=0 summary-hero=1 first-sync=0"*) return 0 ;;
    esac
    [ $(( $(now_ms) - t0 )) -lt $(( limit * 1000 )) ] || return 1
    sleep 2
  done
}

signin() {
  local key
  key=$(grep '^EXPO_PUBLIC_API_KEY=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' | tr -d "'")
  [ -n "$key" ] || { echo "no EXPO_PUBLIC_API_KEY in $ENV_FILE" >&2; exit 2; }
  launch
  sleep 4
  local xml
  xml=$(dump)
  if [ "$(echo "$xml" | count_id login-screen)" -eq 0 ]; then
    echo "not on the login screen; nothing to do"
    return 0
  fi
  if [ "$(echo "$xml" | count_id login-apikey-input)" -eq 0 ]; then
    tap_id login-apikey-section
    sleep 1
  fi
  tap_id login-apikey-input
  sleep 1
  adb shell input text "$key"
  sleep 1
  tap_id login-apikey-button
  echo "connect tapped"
}

debug_on() {
  open_link 'veloq:///settings'
  sleep 3
  local xml c i
  xml=$(dump)
  c=$(bounds_of settings-version-text "$xml")
  [ -n "$c" ] || { echo "settings-version-text not on screen; scroll first" >&2; return 1; }
  for i in 1 2 3 4 5; do
    # shellcheck disable=SC2086
    adb shell input tap $c
  done
  sleep 2
  xml=$(dump)
  echo "$xml" | grep -oE '<node[^>]*resource-id="settings-debug-switch"[^>]*>' | grep -oE 'checked="[a-z]+"' || echo "switch not found"
  if echo "$xml" | grep -oE '<node[^>]*resource-id="settings-debug-switch"[^>]*>' | grep -q 'checked="false"'; then
    tap_id settings-debug-switch
    sleep 1
    dump | grep -oE '<node[^>]*resource-id="settings-debug-switch"[^>]*>' | grep -oE 'checked="[a-z]+"'
  fi
}

widen() {
  open_link 'veloq:///settings'
  sleep 3
  tap_id settings-nav-sync
  sleep 3
  local xml b
  xml=$(dump)
  b=$(echo "$xml" | grep -oE '<node[^>]*resource-id="timeline-slider-track"[^>]*>' | head -1 |
    grep -oE 'bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' |
    sed -E 's/bounds="\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\]"/\1 \2 \3 \4/')
  [ -n "$b" ] || { echo "timeline-slider-track not on screen" >&2; ids; return 1; }
  # shellcheck disable=SC2086
  set -- $b
  adb shell input tap $(( $1 + 4 )) $(( ($2 + $4) / 2 ))
  sleep 2
  xml=$(dump)
  echo "$xml" | grep -oE '<node[^>]*resource-id="history-range-(cost|days)"[^>]*>' | grep -oE 'text="[^"]*"' || true
  tap_id history-range-confirm
}

kill_mid_sync() {
  local hold="${1:-20}" xml b t0
  launch
  sleep 3
  xml=$(dump)
  b=$(echo "$xml" | grep -oE '<node[^>]*resource-id="home-activity-list"[^>]*>' | head -1 |
    grep -oE 'bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' |
    sed -E 's/bounds="\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\]"/\1 \2 \3 \4/')
  [ -n "$b" ] || { echo "home-activity-list not on screen" >&2; ids; return 1; }
  # shellcheck disable=SC2086
  set -- $b
  local x=$(( ($1 + $3) / 2 )) y1=$(( $2 + 200 )) y2=$(( $2 + 1200 ))
  adb logcat -c
  adb shell input swipe "$x" "$y1" "$x" "$y2" 600
  echo "pulled to refresh; holding $hold s"
  t0=$(now_ms)
  while [ $(( $(now_ms) - t0 )) -lt $(( hold * 1000 )) ]; do
    echo "$(( $(now_ms) - t0 )) wal=$(wal_size) sync-lines=$(adb logcat -d -s veloqrs:I 2>/dev/null | grep -c '\[Sync\]' || true)"
    sleep 2
  done
  echo "wal at kill: $(wal_size)"
  adb logcat -d -v threadtime -s veloqrs:I > "$OUT/kill-mid-sync.logcat" 2>/dev/null || true
  adb shell am force-stop "$APP_ID"
  echo "killed; wal after kill: $(wal_size) shm: $(adb shell run-as "$APP_ID" ls -l files/ 2>/dev/null | tr -d '\r' | awk '/routes.db-shm$/ { print $5 }')"
}

relaunch() {
  local label="$1" limit="${2:-150}" t0 line
  adb shell am force-stop "$APP_ID"
  sleep 2
  echo "wal before launch: $(wal_size)"
  adb logcat -c
  t0=$(now_ms)
  launch
  echo "launch returned at $(( $(now_ms) - t0 )) ms"
  : > "$OUT/$label.samples"
  while :; do
    line=$(sample_line "$t0")
    echo "$line" | tee -a "$OUT/$label.samples"
    case "$line" in
    *"skeleton=0 ready="[1-9]*"summary-skeleton=0 summary-hero=1 first-sync=0"*) break ;;
    esac
    [ $(( $(now_ms) - t0 )) -lt $(( limit * 1000 )) ] || break
  done
  adb logcat -d -v threadtime > "$OUT/$label.logcat" 2>/dev/null || true
  grep -E 'Displayed|Start proc .*'"$APP_ID"'|veloqrs|ReactNativeJS' "$OUT/$label.logcat" | head -60
}

# Read every text node in document order, scrolling the dashboard until the
# bottom is reached, so the FFI table and the sync timeline come out whole.
dashboard() {
  local label="$1" xml prev="" i
  open_link 'veloq:///settings'
  sleep 3
  tap_id settings-developer-dashboard-link || { open_link 'veloq:///debug'; }
  sleep 3
  : > "$OUT/$label.dashboard"
  for i in $(seq 1 30); do
    xml=$(dump)
    echo "$xml" | grep -oE 'text="[^"]*"' | sed -E 's/^text="//; s/"$//' >> "$OUT/$label.dashboard"
    if [ "$xml" = "$prev" ]; then break; fi
    prev="$xml"
    # A tap on a collapsed FFI Performance header opens it.
    if echo "$xml" | grep -q 'text="FFI Performance"' && ! echo "$xml" | grep -q 'text="Method"'; then
      local c
      c=$(echo "$xml" | grep -oE '<node[^>]*text="FFI Performance"[^>]*>' | head -1 |
        grep -oE 'bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' |
        sed -E 's/bounds="\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\]"/\1 \2 \3 \4/' |
        awk '{ printf "%d %d\n", ($1+$3)/2, ($2+$4)/2 }')
      # shellcheck disable=SC2086
      [ -z "$c" ] || adb shell input tap $c
      sleep 1
      continue
    fi
    adb shell input swipe 540 1800 540 600 400
    sleep 1
  done
  awk '!seen[$0]++' "$OUT/$label.dashboard" > "$OUT/$label.dashboard.uniq"
  wc -l "$OUT/$label.dashboard.uniq"
}

case "${1:-}" in
focus) focus ;;
ids) ids ;;
tap) tap_id "$2" ;;
signin) signin ;;
wait-feed) wait_feed "${2:-600}" ;;
debug-on) debug_on ;;
widen) widen ;;
wal) wal_size ;;
kill-mid-sync) kill_mid_sync "${2:-20}" ;;
relaunch) relaunch "$2" "${3:-150}" ;;
dashboard) dashboard "$2" ;;
*)
  sed -n '2,20p' "$0"
  exit 2
  ;;
esac
