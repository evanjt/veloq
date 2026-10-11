#!/usr/bin/env bash
# Memory on the iOS simulator: the app plus the WebKit helpers that hold its maps.
#
#   scripts/measure-ios-memory.sh <udid> <bundle-id> <out-dir> [--baseline FILE]
#       [--max-regression FRACTION] [flow.yaml ...]
#
# Runs on the Mac with the booted simulator. Terminates and launches the app,
# takes a reading once it settles, then runs each flow and takes a reading after
# it, by default the two map flows of the pack. A reading is `footprint` of the
# app pid and of every simulator WebKit helper started since the app was
# (`scripts/lib/ios-memory.js` says which), because the app pid alone misses
# about half. Raw captures and `record.json` land in <out-dir>.
#
# With --baseline, each point's total is compared against the baseline record's
# point of the same label, and a total more than --max-regression (default 0.15)
# above it fails the run. The simulator's jetsam never fires, since a simulator
# process uses host memory, so this total is the signal there is.
set -eu

if [ "$#" -lt 3 ]; then
  sed -n '4,5p' "$0" >&2
  exit 2
fi

if [ "${VELOQ_SIM_LOCK_HELD:-}" != "$1" ]; then
  exec "$(dirname "$0")/with-simulator-lock.sh" "$1" "$0" "$@"
fi

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(dirname "$HERE")
UDID=$1
BUNDLE=$2
OUT=$3
shift 3

BASELINE=""
MAX_REGRESSION=0.15
FLOWS=()
while [ "$#" -gt 0 ]; do
  case "$1" in
  --baseline)
    BASELINE=$2
    shift
    ;;
  --max-regression)
    MAX_REGRESSION=$2
    shift
    ;;
  *) FLOWS+=("$1") ;;
  esac
  shift
done
if [ "${#FLOWS[@]}" -eq 0 ]; then
  FLOWS=("$ROOT/.maestro/map-comprehensive.yaml" "$ROOT/.maestro/stress-map-toggles.yaml")
fi

# Seconds for the map to finish loading before a reading.
SETTLE=${VELOQ_IOS_MEMORY_SETTLE:-15}

# A non-interactive shell on the Mac has neither Maestro nor a JDK on its path.
[ -x "$HOME/.maestro/bin/maestro" ] && PATH="$HOME/.maestro/bin:$PATH"
if [ -z "${JAVA_HOME:-}" ] && [ -d /opt/homebrew/opt/openjdk@21 ]; then
  JAVA_HOME=/opt/homebrew/opt/openjdk@21
  PATH="$JAVA_HOME/bin:$PATH"
  export JAVA_HOME
fi
export PATH

mkdir -p "$OUT"
LABELS=()

app_pid() {
  xcrun simctl spawn "$UDID" launchctl list |
    awk -v want="UIKitApplication:$BUNDLE[" 'index($3, want) == 1 && $1 ~ /^[0-9]+$/ { print $1; exit }'
}

reading() {
  local label=$1 pid pids
  sleep "$SETTLE"
  pid=$(app_pid)
  if [ -z "$pid" ]; then
    echo "measure-ios-memory: $BUNDLE is not running on $UDID at $label" >&2
    exit 1
  fi
  ps -axo pid=,ppid=,etime=,comm= >"$OUT/$label.ps"
  pids=$(node "$HERE/ios-memory.mjs" select "$OUT/$label.ps" "$pid")
  # A helper that exits between `ps` and here makes `footprint` complain about
  # that pid and read the rest, and the record names it as missing.
  # shellcheck disable=SC2086
  footprint --noCategories -f bytes $pids >"$OUT/$label.footprint" 2>/dev/null || true
  echo "$pid" >"$OUT/$label.pid"
  LABELS+=("$label")
}

xcrun simctl terminate "$UDID" "$BUNDLE" 2>/dev/null || true
xcrun simctl launch "$UDID" "$BUNDLE" >/dev/null
reading launch

for flow in "${FLOWS[@]}"; do
  # The simulator lock is the lock on this device, and `with-maestro.sh` pins
  # the device it reads from `ANDROID_SERIAL`, so Maestro drives this simulator
  # and no other.
  VELOQ_DEVICE_LOCK_HELD=1 ANDROID_SERIAL=$UDID "$HERE/with-maestro.sh" test "$flow" >/dev/null
  reading "$(basename "$flow" .yaml)"
done

commit=$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)
node "$HERE/ios-memory.mjs" record "$OUT" "$UDID" "$BUNDLE" "$commit" "${LABELS[@]}" >"$OUT/record.json"
echo "measure-ios-memory: $OUT/record.json"

if [ -n "$BASELINE" ]; then
  node "$HERE/ios-memory.mjs" compare "$OUT/record.json" "$BASELINE" "$MAX_REGRESSION"
fi
