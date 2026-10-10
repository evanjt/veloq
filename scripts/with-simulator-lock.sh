#!/usr/bin/env sh
# Run one command holding one iOS simulator, so sessions on one Mac take turns.
#
#   scripts/with-simulator-lock.sh <udid|booted> <command...>
#
# Every session on the Mac shares its booted simulator, and nothing on the
# Android side reaches it: the device lock keys on an adb serial. So one session
# could reinstall, reset or shut down the simulator while another was reading a
# screen or a memory figure off the build it had installed, and neither run
# said so. The Mac has no flock, so the lock is `mkdir` of a directory under
# ~/.veloq-locks, which is atomic, with a holder file naming the host, pid, item
# and start time. `booted` is resolved to the udid it names, so a caller that
# says `booted` and one that names the udid exclude each other.
#
# Exports VELOQ_SIM_LOCK_HELD, the udid held, and a nested call on that udid or
# on `booted` runs without taking anything, the way VELOQ_DEVICE_LOCK_HELD
# stops a helper blocking on the lock its own parent holds.
#
# A holder is abandoned when it is older than VELOQ_SIM_LOCK_MAX_AGE seconds
# (default 14400), or when it names this host and a process that no longer
# runs. VELOQ_SIM_LOCK_WAIT is how many seconds to wait for a live holder before
# refusing (default 0, refuse at once).

set -u

if [ "$#" -lt 2 ]; then
  echo "usage: scripts/with-simulator-lock.sh <udid|booted> <command...>" >&2
  exit 2
fi
target=$1
shift

held="${VELOQ_SIM_LOCK_HELD:-}"
if [ -n "$held" ] && { [ "$target" = booted ] || [ "$target" = "$held" ]; }; then
  exec "$@"
fi

if [ "$target" = booted ]; then
  booted=$(xcrun simctl list devices booted 2>/dev/null |
    sed -n -E 's/.*\(([0-9A-Fa-f-]{36})\) \(Booted\).*/\1/p')
  count=$(printf '%s\n' "$booted" | grep -c .)
  if [ "$count" -eq 0 ]; then
    echo "with-simulator-lock: no simulator is booted" >&2
    exit 2
  fi
  if [ "$count" -gt 1 ]; then
    echo "with-simulator-lock: more than one simulator is booted, name the udid:" >&2
    printf '%s\n' "$booted" | sed 's/^/with-simulator-lock:   /' >&2
    exit 2
  fi
  udid=$booted
else
  udid=$target
fi

root="$HOME/.veloq-locks"
dir="$root/sim-$udid"
host="${VELOQ_SIM_HOST:-$(hostname 2>/dev/null || echo unknown)}"
item="${VELOQ_SIM_ITEM:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)}"
max_age="${VELOQ_SIM_LOCK_MAX_AGE:-14400}"
wait_for="${VELOQ_SIM_LOCK_WAIT:-0}"
mine="host=$host pid=$$ item=$item since=$(date +%s)"

field() { printf '%s\n' "$2" | tr ' ' '\n' | sed -n "s/^$1=//p" | head -1; }

# Whether the holder line names a lock nobody is using any more.
abandoned() {
  since=$(field since "$1")
  pid=$(field pid "$1")
  [ -n "$since" ] || return 0
  [ $(($(date +%s) - since)) -gt "$max_age" ] && return 0
  if [ "$(field host "$1")" = "$host" ] && [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
    return 0
  fi
  return 1
}

mkdir -p "$root"
waited=0
while ! mkdir "$dir" 2>/dev/null; do
  holder=$(cat "$dir/holder" 2>/dev/null || true)
  # A taker between its mkdir and its holder write: give it a moment before
  # reading the empty holder as abandoned.
  if [ -z "$holder" ]; then
    sleep 1
    holder=$(cat "$dir/holder" 2>/dev/null || true)
  fi
  if abandoned "$holder"; then
    echo "with-simulator-lock: taking over an abandoned hold ($holder)" >&2
    rm -rf "$dir"
    continue
  fi
  if [ "$waited" -ge "$wait_for" ]; then
    echo "with-simulator-lock: simulator $udid is held: $holder" >&2
    echo "with-simulator-lock: held since $(field since "$holder"), by item $(field item "$holder") on $(field host "$holder")" >&2
    exit 75
  fi
  sleep 2
  waited=$((waited + 2))
done
echo "$mine" >"$dir/holder"

release() {
  [ "$(cat "$dir/holder" 2>/dev/null)" = "$mine" ] && rm -rf "$dir"
  return 0
}

VELOQ_SIM_LOCK_HELD=$udid
export VELOQ_SIM_LOCK_HELD

"$@" &
child=$!
trap 'kill -TERM "$child" 2>/dev/null' INT TERM HUP
status=0
wait "$child" || status=$?
# A trapped signal ends the first wait early; wait again for the real status.
if kill -0 "$child" 2>/dev/null; then wait "$child" || status=$?; fi
release
exit "$status"
