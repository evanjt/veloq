#!/usr/bin/env bash
# capture-first-load.sh - Snapshot the app through a first load: screen, screen text and database.
#
# A record that shows and then vanishes during a first sync lives in neither the settled database
# nor the settled screen, so this takes both at a fixed interval while the load runs. Each
# snapshot is a directory holding the database with its sidecars, the focused window, and, when
# Veloq is the app in front, a screenshot and the UI hierarchy. `scripts/first-load-records.py`
# reads the snapshots back.
#
# Usage:
#   ANDROID_SERIAL=emulator-5554 ./scripts/capture-first-load.sh <output dir>
#
# INTERVAL (seconds, default 5) and DURATION (seconds, default 900) pace it, and APP_ID names the
# build, the dev build unless it says otherwise. The build has to be debuggable: `run-as` is the
# only way to the database. The output holds the athlete's GPS, so it never goes in a repository.

set -euo pipefail

# A capture is a measurement: a second session relaunching the app mid-run lands in this one.
if [ -z "${VELOQ_DEVICE_LOCK_HELD:-}" ]; then
  exec "$(dirname "$0")/with-device-lock.sh" "$0" "$@"
fi

OUT="${1:?usage: capture-first-load.sh <output dir>}"
APP_ID="${APP_ID:-com.veloq.app.dev}"
INTERVAL="${INTERVAL:-5}"
DURATION="${DURATION:-900}"

mkdir -p "$OUT"
end=$((SECONDS + DURATION))
n=0
while [ "$SECONDS" -lt "$end" ]; do
  dir="$OUT/$(printf '%04d' "$n")"
  mkdir -p "$dir"
  date -u +%Y-%m-%dT%H:%M:%SZ > "$dir/time"

  # One tar keeps the main file and its write-ahead log as close together as a copy can.
  adb exec-out run-as "$APP_ID" sh -c 'cd files && tar cf - routes.db routes.db-wal routes.db-shm 2>/dev/null' \
    | tar xf - -C "$dir" 2>/dev/null || true

  # A screenshot of another app is a breach, not a wasted frame: read the focus first.
  focus="$(adb shell dumpsys window | grep mCurrentFocus || true)"
  printf '%s\n' "$focus" > "$dir/focus"
  if printf '%s' "$focus" | grep -q "$APP_ID"; then
    adb exec-out screencap -p > "$dir/screen.png"
    adb exec-out uiautomator dump /dev/tty > "$dir/ui.xml" 2>/dev/null || true
  fi

  n=$((n + 1))
  sleep "$INTERVAL"
done
echo "capture-first-load: $n snapshots in $OUT"
