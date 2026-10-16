#!/bin/bash
# Run one cargo build inside the machine-wide cap on concurrent builds.
#
#   with-cargo-slot.sh <command> [args...]
#
# Each worktree builds on its own and cargo gives every build its configured
# jobs, so forty job trees building at once ran hundreds of compilers on a
# 32-core host, filled its swap and stopped it answering. A slot is one of
# `VELOQ_CARGO_SLOTS` lock files (4 unless set): a build takes the first free
# one and waits while none is. A build started inside one, such as a gate that
# calls a script that builds, takes nothing further, or it would wait on the
# slot its own parent holds.
#
# The slot is held by this script and closed for the command, so a daemon the
# build leaves behind (the compiler cache server) does not keep it for ever.
# Without `flock`, which macOS lacks, the command runs uncapped.
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo 'usage: with-cargo-slot.sh <command> [args...]' >&2
  exit 2
fi

if [ -n "${VELOQ_CARGO_SLOT_HELD:-}" ] || ! command -v flock >/dev/null; then
  exec "$@"
fi

SLOTS=${VELOQ_CARGO_SLOTS:-4}
if ! [[ "$SLOTS" =~ ^[1-9][0-9]*$ ]]; then
  echo "with-cargo-slot: VELOQ_CARGO_SLOTS must be a positive count, not '$SLOTS'" >&2
  exit 2
fi

# A fixed path, so every session on the machine counts against the same slots.
# `VELOQ_CARGO_SLOT_DIR` is for the tests, which must not queue behind the fleet.
if [ -n "${VELOQ_CARGO_SLOT_DIR:-}" ]; then
  DIR=$VELOQ_CARGO_SLOT_DIR
else
  DIR="/tmp/claude-$(id -u)"
  [ -d "$DIR" ] || DIR=/tmp
  DIR="$DIR/veloq-cargo-slots"
fi
mkdir -p "$DIR"

said=
while :; do
  for ((i = 0; i < SLOTS; i++)); do
    exec {slot}>>"$DIR/slot-$i"
    if flock -n "$slot"; then
      export VELOQ_CARGO_SLOT_HELD="$DIR/slot-$i"
      status=0
      "$@" {slot}>&- || status=$?
      exit "$status"
    fi
    exec {slot}>&-
  done
  if [ -z "$said" ]; then
    echo "with-cargo-slot: all $SLOTS cargo slots are in use, waiting for one" >&2
    said=1
  fi
  sleep 1
done
