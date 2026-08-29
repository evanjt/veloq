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
failed=$(
  tr '\n' ' ' <"$report" |
    sed 's|<testcase|\n<testcase|g' |
    grep '<failure' |
    sed -n 's|^<testcase[^>]* name="\([^"]*\)".*|\1|p'
)

if [ -z "$failed" ]; then
  echo "Suite failed but $report names no failed flow. Not retrying."
  exit 1
fi

mkdir -p retry-reports
status=0
for flow in $failed; do
  file=".maestro/$flow.yaml"
  if [ ! -f "$file" ]; then
    echo "No flow file for failed testcase '$flow'."
    status=1
    continue
  fi
  echo "Retrying $file"
  "$MAESTRO" test "$file" --debug-output "$debug" \
    --format junit --output "retry-reports/$flow.xml" --no-ansi || status=1
done
exit "$status"
