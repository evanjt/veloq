#!/usr/bin/env sh
# Run one measurement at a time against one handset.
#
# `docket start` locks the item, not the hardware, and two items can need the
# same phone. Working `I191` beside `I109` on 2026-09-15, one session was
# opening an activity to time its map while the other reset `gfxinfo`, swiped
# the strength diagram and read a frame histogram back: the histogram carried
# the other item's map load. Both numbers looked plausible, neither run said
# anything, and both were about to go into an item as measured fact. That is
# `B340`'s hazard, a run that measures the fleet rather than the change, moved
# from the host to the handset.
#
# Keyed on the serial, so the S22 and an emulator do not queue behind each
# other. It is not the Android build lock: a build holds that for a quarter of
# an hour and a measurement must not wait on one, and a build touches no
# device. An agent driving `adb` by hand takes it for a whole session with
#
#     scripts/device-lock-shell.sh sh -c '...'
#
# and never with a bare `flock` on the same path, which marks nothing and so
# blocks anything under it against its own parent (`B1156`).

set -eu

# Already inside a lock this script took, so take nothing: a flock is held per
# open file description, and a second take blocks the child on its own parent.
# That is `B624`, one layer down.
if [ -n "${VELOQ_DEVICE_LOCK_HELD:-}" ]; then
  exec "$@"
fi

. "$(dirname "$0")/device-lock-path.sh"

veloq_refuse_if_ambiguous with-device-lock || exit 2

if ! command -v flock >/dev/null 2>&1; then
  echo "with-device-lock: no flock, running unserialised" >&2
  exec "$@"
fi

if ! flock -n "$VELOQ_DEVICE_LOCK_PATH" true 2>/dev/null; then
  # Say that the holder may be the caller, since that is the case an agent
  # cannot tell from here: a bare `flock` upstream marks nothing.
  echo "with-device-lock: something holds $VELOQ_DEVICE_LOCK_PATH, waiting" >&2
  echo "with-device-lock: another session, or you may be holding it yourself" >&2
  echo "with-device-lock: take it with scripts/device-lock-shell.sh, not a bare flock" >&2
fi

VELOQ_DEVICE_LOCK_HELD=1
export VELOQ_DEVICE_LOCK_HELD
exec flock "$VELOQ_DEVICE_LOCK_PATH" "$@"
