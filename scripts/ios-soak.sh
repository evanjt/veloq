#!/usr/bin/env bash
# Soak the map surfaces on the iOS simulator and count what dies.
#
#   scripts/ios-soak.sh <udid> <out-dir> <cycles> <surface>...
#
# Runs on the Mac with the booted simulator and the dev build installed. A
# surface is a flow under `.maestro/soak/` (feed, activity-map, terrain,
# regional-map, heatmap, section, routes, recording, browse). Each runs CYCLES times
# inside one Maestro run, and the script writes `<out-dir>/<surface>.json` with
# the Maestro exit status, the app pid at the start and the end, the new `.ips`
# crash logs, how many renderer deaths the app itself recorded, how many
# WebContent processes the log says terminated (reason included), one injected kill
# when VELOQ_SOAK_KILL_AFTER names a second, and a memory sample every
# VELOQ_SOAK_SAMPLE seconds (the app plus its WebKit helpers, `footprint`).
#
# The flows read `ACTIVITY` and `SECTION`, named in the environment (the section
# surface refuses to start without `SECTION` and `SECTION_ALT`), and enter
# demo mode when the app is signed out. Take no flow of the pack's demo helper
# against a signed-in library: this script's flows never sign out.
set -u

if [ "$#" -lt 4 ]; then
  sed -n '3,4p' "$0" >&2
  exit 2
fi

# The section flow opens a section by id, and an id from another library is absent here.
for surface in "${@:4}"; do
  if [ "$surface" = section ] && { [ -z "${SECTION:-}" ] || [ -z "${SECTION_ALT:-}" ]; }; then
    echo "ios-soak: the section surface needs SECTION and SECTION_ALT, two section ids the installed library holds" >&2
    exit 2
  fi
done

if [ "${VELOQ_SIM_LOCK_HELD:-}" != "$1" ]; then
  exec "$(dirname "$0")/with-simulator-lock.sh" "$1" "$0" "$@"
fi

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(dirname "$HERE")
UDID=$1
OUT=$2
CYCLES=$3
shift 3

BUNDLE=${VELOQ_SOAK_BUNDLE:-com.veloq.app.dev}
SAMPLE=${VELOQ_SOAK_SAMPLE:-20}
REPORTS=$HOME/Library/Logs/DiagnosticReports
mkdir -p "$OUT"

app_pid() {
  xcrun simctl spawn "$UDID" launchctl list |
    awk -v want="UIKitApplication:$BUNDLE[" 'index($3, want) == 1 && $1 ~ /^[0-9]+$/ { print $1; exit }'
}

sim_launchd() {
  pgrep -f "launchd_sim .*/Devices/$UDID/" | head -n 1
}

# The WebContent pids under this simulator, one per line.
web_pids() {
  local launchd
  launchd=$(sim_launchd)
  [ -n "$launchd" ] || return 0
  pgrep -P "$launchd" -f com.apple.WebKit.WebContent || true
}

# One sample: epoch, app bytes, helper bytes, total bytes, WebContent count.
sample() {
  local pid pids
  pid=$(app_pid)
  [ -n "$pid" ] || {
    echo "$(date +%s) 0 0 0 0"
    return
  }
  ps -axo pid=,ppid=,etime=,comm= >"$1.ps"
  pids=$(node "$HERE/ios-memory.mjs" select "$1.ps" "$pid")
  # shellcheck disable=SC2086
  footprint --noCategories -f bytes $pids >"$1.fp" 2>/dev/null || true
  node -e '
    const memory = require(process.argv[1]);
    const fs = require("fs");
    const point = memory.readPoint("s", fs.readFileSync(process.argv[2], "utf8"), fs.readFileSync(process.argv[3], "utf8"), Number(process.argv[4]));
    const web = process.argv[5];
    console.log([Math.floor(Date.now() / 1000), point.appBytes, point.helperBytes, point.totalBytes, web].join(" "));
  ' "$HERE/lib/ios-memory.js" "$1.ps" "$1.fp" "$pid" "$(web_pids | wc -l | tr -d ' ')" 2>/dev/null ||
    echo "$(date +%s) 0 0 0 0"
}

run_surface() {
  local surface=$1 dir=$OUT/$surface
  mkdir -p "$dir"
  local flow=$ROOT/.maestro/soak/$surface.yaml
  [ -f "$flow" ] || {
    echo "ios-soak: no flow $flow" >&2
    return 1
  }
  xcrun simctl terminate "$UDID" "$BUNDLE" 2>/dev/null || true
  xcrun simctl launch "$UDID" "$BUNDLE" >/dev/null
  sleep 15

  local start_pid start_epoch
  start_pid=$(app_pid)
  start_epoch=$(date +%s)
  touch "$dir/start.mark"
  : >"$dir/samples.txt"
  : >"$dir/webpids.txt"

  # The sampler runs beside Maestro until the flow ends.
  (
    while :; do
      sample "$dir/s" >>"$dir/samples.txt"
      web_pids >>"$dir/webpids.txt"
      sleep "$SAMPLE"
    done
  ) &
  local sampler=$!

  # The simulator's own log, for the WebKit side of a death.
  xcrun simctl spawn "$UDID" log stream --style compact \
    --predicate 'subsystem == "com.apple.WebKit" AND (eventMessage CONTAINS "processDidTerminateOrFailedToLaunch" OR eventMessage CONTAINS "WebPageProxy::loadData")' \
    >"$dir/webkit.log" 2>&1 &
  local logger=$!

  # One WebContent process is killed once, VELOQ_SOAK_KILL_AFTER seconds in, to see the page
  # come back. The log says how many deaths were that kill and how many were not.
  local killer=""
  if [ "${VELOQ_SOAK_KILL_AFTER:-0}" -gt 0 ]; then
    (
      sleep "$VELOQ_SOAK_KILL_AFTER"
      pid=$(pgrep -n -P "$(sim_launchd)" -f com.apple.WebKit.WebContent) && kill -9 "$pid" && echo "$pid" >"$dir/injected.txt"
    ) &
    killer=$!
  fi

  VELOQ_DEVICE_LOCK_HELD=1 ANDROID_SERIAL=$UDID MAESTRO_DRIVER_STARTUP_TIMEOUT=180000 \
    "$HERE/with-maestro.sh" test "$flow" \
    -e CYCLES="$CYCLES" -e ACTIVITY="${ACTIVITY:-demo-test-0}" -e SECTION="${SECTION:-}" -e SECTION_ALT="${SECTION_ALT:-}" \
    >"$dir/maestro.log" 2>&1
  local status=$?

  kill "$sampler" "$logger" $killer 2>/dev/null || true
  wait "$sampler" "$logger" $killer 2>/dev/null || true
  sample "$dir/s" >>"$dir/samples.txt"

  local end_pid ips
  end_pid=$(app_pid)
  for ips in $(find "$REPORTS" -name '*.ips' -newer "$dir/start.mark" 2>/dev/null); do
    if grep -q -E "Veloq|WebContent" "$ips"; then cp "$ips" "$dir/"; fi
  done

  local seen ended
  seen=$(sort -u "$dir/webpids.txt" | grep -c . || true)
  ended=$(grep -c "processDidTerminateOrFailedToLaunch: reason=" "$dir/webkit.log" || true)
  injected=0
  [ ! -s "$dir/injected.txt" ] || injected=1
  reloads=$(grep -c "WebPageProxy::loadData:" "$dir/webkit.log" || true)

  node -e '
    const fs = require("fs");
    const [dir, surface, status, startPid, endPid, cycles, seen, ended, startEpoch, injected, reloads] = process.argv.slice(1);
    const rows = fs.readFileSync(dir + "/samples.txt", "utf8").trim().split("\n").filter(Boolean)
      .map((l) => l.split(" ").map(Number)).filter((r) => r[3] > 0);
    const mib = (b) => Math.round(b / 1048576);
    const ips = fs.readdirSync(dir).filter((f) => f.endsWith(".ips"));
    const totals = rows.map((r) => r[3]);
    const record = {
      surface,
      cycles: Number(cycles),
      maestroExit: Number(status),
      appPidStart: Number(startPid),
      appPidEnd: Number(endPid),
      appRestarted: startPid !== endPid,
      ipsFiles: ips,
      webContentPidsSeen: Number(seen),
      webContentTerminations: Number(ended),
      injectedKills: Number(injected),
      uninjectedTerminations: Number(ended) - Number(injected),
      pageLoadsAfterStart: Number(reloads),
      seconds: rows.length ? rows[rows.length - 1][0] - Number(startEpoch) : 0,
      samples: rows.length,
      totalMiB: { first: totals.length ? mib(totals[0]) : 0, min: totals.length ? mib(Math.min(...totals)) : 0, max: totals.length ? mib(Math.max(...totals)) : 0, last: totals.length ? mib(totals[totals.length - 1]) : 0 },
      series: rows.map((r) => [r[0] - Number(startEpoch), mib(r[1]), mib(r[2]), mib(r[3]), r[4]]),
    };
    fs.writeFileSync(dir + ".json", JSON.stringify(record, null, 2));
    const t = record.totalMiB;
    console.log([surface, "cycles=" + cycles, "maestro=" + status, "appRestarted=" + record.appRestarted, "ips=" + ips.length, "webContentTerminations=" + ended + "(injected " + injected + ")", "webContentPids=" + seen, "total MiB first/min/max/last=" + [t.first, t.min, t.max, t.last].join("/"), record.seconds + "s"].join("  "));
  ' "$dir" "$surface" "$status" "$start_pid" "$end_pid" "$CYCLES" "$seen" "$ended" "$start_epoch" "$injected" "$reloads"
  return "$status"
}

failed=0
for surface in "$@"; do
  run_surface "$surface" || failed=1
done
exit "$failed"
