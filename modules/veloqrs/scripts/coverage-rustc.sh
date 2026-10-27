#!/bin/bash
# The workspace rustc wrapper for the coverage lane: it compiles tracematch
# without coverage counters and passes every other crate through.
#
#   RUSTC_WORKSPACE_WRAPPER=modules/veloqrs/scripts/coverage-rustc.sh \
#     cargo llvm-cov nextest -p veloqrs ...
#
# cargo-llvm-cov instruments every workspace member, and the floors in
# scripts/check-rust-coverage.mjs count only veloqrs. Counters in tracematch's
# geometry loops are written by every detection thread at once, which made the
# year-long lifecycle scenarios five times slower than a plain debug build and
# pushed them past the per-test timeout. veloqrs keeps its counters, so the
# lines the floors read are measured exactly as before.
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo 'usage: coverage-rustc.sh <rustc> [args...]' >&2
  exit 2
fi

rustc=$1
shift

crate=
prev=
for arg in "$@"; do
  if [ "$prev" = --crate-name ]; then
    crate=$arg
  fi
  prev=$arg
done

if [ "$crate" != tracematch ]; then
  exec "$rustc" "$@"
fi

kept=()
while [ "$#" -gt 0 ]; do
  case $1 in
    -Cinstrument-coverage | -Cinstrument-coverage=*)
      shift
      continue
      ;;
    -C)
      if [ "$#" -gt 1 ] && [[ $2 == instrument-coverage || $2 == instrument-coverage=* ]]; then
        shift 2
        continue
      fi
      ;;
  esac
  kept+=("$1")
  shift
done

exec "$rustc" ${kept[@]+"${kept[@]}"}
