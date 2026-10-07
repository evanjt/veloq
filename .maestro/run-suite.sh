#!/usr/bin/env bash
# Run one tagged Maestro suite, then retry only the flows that failed.
#
# Usage: run-suite.sh <report.xml> <debug-dir> <maestro arg>...
#
# The gate used to rerun the whole suite on failure. That second pass started
# from the first pass's residual device state, so it proved nothing about a
# clean launch and cost a full run to say so. Retrying the failed flows alone
# gives each one a fresh install path, and a flow that fails twice fails the
# gate.
set -uo pipefail

# A flow force-stops the app and clears its data, so a hand run takes the
# device lock like every other script that drives a handset. CI attaches one
# emulator, where the lock buys nothing.
if [ -z "${CI:-}" ] && [ -z "${VELOQ_DEVICE_LOCK_HELD:-}" ]; then
  exec "$(dirname "$0")/../scripts/with-device-lock.sh" "$0" "$@"
fi

MAESTRO="${MAESTRO_BIN:-$HOME/.maestro/bin/maestro}"

# Which device every invocation runs on. Maestro picks one itself when it is
# not told, and shards the suite across everything attached: an unpinned local
# run on 2026-09-09 put two flows on a phone that was not the target, logged as
# `[shard 1] Selected device 10.0.0.3:5555`. CI attaches one device, so the
# gate never sees this and the cost lands on whoever runs the suite by hand.
# `--device` is a global flag, so it goes ahead of `test`.
#
# Both arrays are expanded as `${a[@]+"${a[@]}"}`, since bash before 4.4 reads
# an empty array under `set -u` as unbound and stops the script, and macOS
# ships bash 3.2.
device=()
adb_device=()
# Under the lock the locked serial is the default, so the suite drives the
# phone whose lock it holds.
MAESTRO_DEVICE="${MAESTRO_DEVICE:-${VELOQ_DEVICE_SERIAL:-}}"
if [ -n "$MAESTRO_DEVICE" ]; then
  device=(--device "$MAESTRO_DEVICE")
  adb_device=(-s "$MAESTRO_DEVICE")
fi

report="$1"
debug="$2"
shift 2

if "$MAESTRO" ${device[@]+"${device[@]}"} test .maestro/ "$@" --debug-output "$debug" --format junit --output "$report" --no-ansi; then
  exit 0
fi

# Maestro names each testcase after the flow file's basename, so a failed
# testcase maps straight back to a file. `maestroFlowTags` holds that mapping
# by forbidding a `name:` override in a flow header.
#
# A dead device is not a failed flow. Under software GL a MapLibre surface
# starves Maestro's driver, `viewHierarchy` and `takeScreenshot` throw
# `DeviceServerDiedException`, and every flow queued behind it reports
# `Unknown error` in milliseconds. Across three failing `map-gate` runs not one
# flow failed on an assertion. So the classification is the whole point: a
# death restarts the device once and the flows behind it get a clean shot,
# while a flow that failed on a step is retried the way it always was and
# still fails the gate if it fails twice.
#
# The 5 second floor is what separates the two `Unknown error` shapes. A flow
# poisoned by a dead device reports in 14 to 73 ms; one that ran and then
# failed takes a flow's worth of time.
failed=$(
  awk 'BEGIN { RS = "<testcase" }
    /<failure/ {
      name = ""; time = ""
      if (match($0, /name="[^"]*"/)) name = substr($0, RSTART + 6, RLENGTH - 7)
      if (match($0, /time="[^"]*"/)) time = substr($0, RSTART + 6, RLENGTH - 7)
      dead = ($0 ~ /DeviceServerDied/) || ($0 ~ /Unknown error/ && time + 0 < 5)
      print name (dead ? " device" : " step")
    }' "$report"
)

if [ -z "$failed" ]; then
  echo "Suite failed but $report names no failed flow. Not retrying."
  exit 1
fi

# Best effort, and overridable so the gate can name whatever its runner needs.
# The driver runs on the device, so the adb connection and the driver process
# are what a restart has to reach.
restart_device() {
  if [ -n "${MAESTRO_RESTART_CMD:-}" ]; then
    eval "$MAESTRO_RESTART_CMD"
    return
  fi
  # `kill-server` is server-wide: it drops every attached device's connection,
  # not just this one's. That is fine on the gate's single-device runner and
  # not fine on a workstation, so a named device gets the scoped restart and
  # only CI restarts the whole server.
  if [ ${#adb_device[@]} -eq 0 ] && [ -n "${CI:-}" ]; then
    adb kill-server || true
    adb start-server || true
  fi
  adb ${adb_device[@]+"${adb_device[@]}"} wait-for-device || true
  adb ${adb_device[@]+"${adb_device[@]}"} shell am force-stop dev.mobile.maestro || true
}

# The restart above revives the device the suite pass lost. It says nothing about
# the device the *retry* pass is standing on, and on 2026-09-09 that was the whole
# failure: `auth-api-key-validation` was retried and passed, the device went with
# it, and the four flows behind it were each retried against nothing and reported
# `Unknown error` in seconds. A flow that never saw a live device has not been
# tested, so failing the gate on it names a bug nobody observed.
device_alive() {
  if [ -n "${MAESTRO_HEALTH_CMD:-}" ]; then
    eval "$MAESTRO_HEALTH_CMD" > /dev/null 2>&1
    return
  fi
  [ "$(adb ${adb_device[@]+"${adb_device[@]}"} shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]
}

if printf '%s\n' "$failed" | grep -q ' device$'; then
  echo "The device server died. Restarting it once before the retry pass."
  restart_device
fi

mkdir -p retry-reports
status=0
retried=""
while read -r flow verdict; do
  [ -n "$flow" ] || continue
  file=".maestro/$flow.yaml"
  if [ ! -f "$file" ]; then
    echo "No flow file for failed testcase '$flow'."
    status=1
    continue
  fi
  if ! device_alive; then
    echo "The device is not answering before $file. Restarting it."
    restart_device
  fi
  echo "Retrying $file ($verdict)"
  # A report an earlier run left here would otherwise stand in for this retry.
  rm -f "retry-reports/$flow.xml"
  retried="$retried $flow"
  "$MAESTRO" ${device[@]+"${device[@]}"} test "$file" --debug-output "$debug" \
    --format junit --output "retry-reports/$flow.xml" --no-ansi || status=1
done <<EOF_FAILED
$failed
EOF_FAILED

# The gate is decided on the retries, and the summary and the junit check read
# the named report, so the report takes each retry's result in place of the
# first pass's. Otherwise a suite the retries recovered reads as failed.
if command -v node >/dev/null 2>&1; then
  # Flow names carry no spaces, since each is a file's basename.
  # shellcheck disable=SC2086
  node "$(dirname "$0")/merge-retry-reports.mjs" "$report" retry-reports $retried ||
    echo "Could not fold the retry reports into $report, so it holds the first pass."
else
  echo "No node to fold the retry reports into $report, so it holds the first pass."
fi
exit "$status"
