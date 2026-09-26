#!/usr/bin/env sh
# Hold one handset for a whole session of hand-driven `adb`, and say so, so a
# `scripts/` helper started underneath runs instead of blocking.
#
# A flock is held per open file description, so the bare form documented here
# until `B1156`,
#
#     flock /tmp/claude-$(id -u)/veloq-device-<serial>.lock -c '...'
#
# deadlocked the moment anything under it re-exec'd through
# `with-device-lock.sh`: the child waited on the lock its own parent held, and
# the message named another session. This takes the same lock and exports
# `VELOQ_DEVICE_LOCK_HELD`, which is what the wrapper reads to take nothing.
#
#     scripts/device-lock-shell.sh sh -c '...'
#     scripts/device-lock-shell.sh "$SHELL"

set -eu

. "$(dirname "$0")/device-lock-path.sh"

veloq_refuse_if_ambiguous device-lock-shell || exit 2

if ! command -v flock >/dev/null 2>&1; then
  echo "device-lock-shell: no flock, running unserialised" >&2
  VELOQ_DEVICE_LOCK_HELD=1
  export VELOQ_DEVICE_LOCK_HELD
  exec "$@"
fi

if ! flock -n "$VELOQ_DEVICE_LOCK_PATH" true 2>/dev/null; then
  echo "device-lock-shell: another session holds $VELOQ_DEVICE_LOCK_PATH, waiting" >&2
fi

VELOQ_DEVICE_LOCK_HELD=1
export VELOQ_DEVICE_LOCK_HELD
exec flock "$VELOQ_DEVICE_LOCK_PATH" "$@"
