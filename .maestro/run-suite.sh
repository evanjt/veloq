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

MAESTRO="${MAESTRO_BIN:-$HOME/.maestro/bin/maestro}"
report="$1"
debug="$2"
shift 2

if "$MAESTRO" test .maestro/ "$@" --debug-output "$debug" --format junit --output "$report" --no-ansi; then
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
  adb kill-server || true
  adb start-server || true
  adb wait-for-device || true
  adb shell am force-stop dev.mobile.maestro || true
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
  [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]
}

if printf '%s\n' "$failed" | grep -q ' device$'; then
  echo "The device server died. Restarting it once before the retry pass."
  restart_device
fi

mkdir -p retry-reports
status=0
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
  "$MAESTRO" test "$file" --debug-output "$debug" \
    --format junit --output "retry-reports/$flow.xml" --no-ansi || status=1
done <<EOF_FAILED
$failed
EOF_FAILED
exit "$status"
