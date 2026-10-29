#!/usr/bin/env sh
# Hold the screen compare captures against the goldens, or hand them on as
# candidates, from the workspace the capture ran in:
#
#   scripts/screen-compare-ci.sh <android|ios> <compare|capture>
#
# Either way the captures are copied to
# screen-compare/candidates/<platform>/<theme>/<screen>.png, the layout of
# .maestro/goldens, so a candidate set is signed off by copying it there and
# committing. `compare` then runs scripts/screenshot-compare.mjs, which writes a
# diff image per failing screen under screen-compare/diffs/ and fails on a
# missing golden. `capture` compares nothing: it is how the first goldens, and
# any later rebase, are taken from the runner image that compares them.
#
# Nothing here writes a golden. One changes only by a commit made after the
# owner has read the before-and-after report.

set -eu

if [ "$#" -ne 2 ]; then
  echo "usage: scripts/screen-compare-ci.sh <android|ios> <compare|capture>" >&2
  exit 2
fi
platform=$1
mode=$2
case "$platform" in
android | ios) ;;
*)
  echo "screen-compare-ci: no platform $platform, only android and ios" >&2
  exit 2
  ;;
esac
case "$mode" in
compare | capture) ;;
*)
  echo "screen-compare-ci: no mode $mode, only compare and capture" >&2
  exit 2
  ;;
esac

here=$(cd "$(dirname "$0")" && pwd)
captures=screenshots/compare
candidates=screen-compare/candidates/$platform

# Maestro resolves a flow's relative screenshot path against the workspace on
# some versions and against its own run directory under ~/.maestro/tests on
# others. Without captures in the workspace, the newest run's are used.
if [ ! -d "$captures" ]; then
  run_captures=$(ls -d "${HOME:-/nonexistent}"/.maestro/tests/*/screenshots/compare 2>/dev/null | sort | tail -1)
  if [ -n "$run_captures" ]; then
    echo "screen-compare-ci: no $captures, using the Maestro run at $run_captures" >&2
    captures=$run_captures
  else
    echo "screen-compare-ci: no $captures and no Maestro run under ~/.maestro/tests holds one" >&2
    find screenshots "${HOME:-/nonexistent}/.maestro" -name '*.png' 2>/dev/null | head -20 >&2 || true
  fi
fi

mkdir -p "$candidates"
if [ -d "$captures" ]; then
  cp -R "$captures/." "$candidates/"
fi

if [ "$mode" = capture ]; then
  if [ -z "$(find "$candidates" -name '*.png' | head -1)" ]; then
    echo "screen-compare-ci: the capture wrote nothing under $captures" >&2
    exit 1
  fi
  echo "screen-compare-ci: candidates for $platform under $candidates, compared with nothing."
  echo "screen-compare-ci: a golden changes only by a commit, after the before-and-after report is signed off."
  exit 0
fi

exec node "$here/screenshot-compare.mjs" --platform "$platform" \
  --goldens .maestro/goldens --candidates "$captures" --diffs screen-compare/diffs
