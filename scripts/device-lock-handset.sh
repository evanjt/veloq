#!/usr/bin/env sh
# Run one command holding the lock that lives on the handset itself.
#
# The lock in `device-lock-path.sh` is a file in one machine's /tmp, so it
# serialises the sessions of that machine and nobody else. A network handset is
# reachable from every host's adb server, and another host can install over the
# build under test, serve its own Metro through `adb reverse` or open another
# app while this host's lock reads free. So the same exclusion is also taken on
# the handset: `mkdir` of a directory is atomic there, and a holder file inside
# it names the host, pid, item and start time.
#
# Taken after the local lock, by `with-device-lock.sh` and `device-lock-shell.sh`,
# and released when the command ends, whatever its exit code.
#
# A holder is abandoned when it is older than VELOQ_DEVICE_LOCK_MAX_AGE seconds
# (default 14400), or when it names this host and a process that no longer runs.
# VELOQ_DEVICE_LOCK_WAIT is how many seconds to wait for a live holder before
# refusing (default 0, refuse at once).

set -u

# VELOQ_DEVICE_LOCK_HANDSET=0 takes nothing on the handset, =1 takes it even with
# an explicit local lock path, which is otherwise the sign of a test that must
# not touch a real handset.
use="${VELOQ_DEVICE_LOCK_HANDSET:-}"
[ -n "$use" ] || { [ -n "${VELOQ_DEVICE_LOCK:-}" ] && use=0 || use=1; }
if [ "$use" != 1 ] || [ -z "${VELOQ_DEVICE_SERIAL:-}" ] || ! command -v adb >/dev/null 2>&1; then
  exec "$@"
fi

dir=/data/local/tmp/veloq-device-lock
host="${VELOQ_DEVICE_HOST:-$(hostname 2>/dev/null || echo unknown)}"
item="${VELOQ_DEVICE_ITEM:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)}"
max_age="${VELOQ_DEVICE_LOCK_MAX_AGE:-14400}"
wait_for="${VELOQ_DEVICE_LOCK_WAIT:-0}"
mine="host=$host pid=$$ item=$item since=$(date +%s)"

handset() { adb -s "$VELOQ_DEVICE_SERIAL" shell "$@" 2>&1 | tr -d '\r'; }

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

taken=""
waited=0
while :; do
  out=$(handset "mkdir $dir")
  if [ -z "$out" ]; then
    taken=1
    break
  fi
  case "$out" in
    *exists*) ;;
    *)
      echo "device-lock-handset: cannot take the lock on $VELOQ_DEVICE_SERIAL: $out" >&2
      echo "device-lock-handset: running without the handset lock" >&2
      exec "$@"
      ;;
  esac
  holder=$(handset "cat $dir/holder")
  case "$holder" in *No\ such\ file*) holder="" ;; esac
  if abandoned "$holder"; then
    echo "device-lock-handset: taking over an abandoned hold ($holder)" >&2
    handset "rm -r $dir" >/dev/null
    continue
  fi
  if [ "$waited" -ge "$wait_for" ]; then
    echo "device-lock-handset: $VELOQ_DEVICE_SERIAL is held: $holder" >&2
    echo "device-lock-handset: held since $(field since "$holder"), by item $(field item "$holder") on $(field host "$holder")" >&2
    exit 75
  fi
  sleep 2
  waited=$((waited + 2))
done

handset "echo '$mine' > $dir/holder" >/dev/null

release() {
  [ -n "$taken" ] || return 0
  taken=""
  [ "$(handset "cat $dir/holder")" = "$mine" ] && handset "rm -r $dir" >/dev/null
  return 0
}

"$@" &
child=$!
trap 'kill -TERM "$child" 2>/dev/null' INT TERM HUP
status=0
wait "$child" || status=$?
# A trapped signal ends the first wait early; wait again for the real status.
if kill -0 "$child" 2>/dev/null; then wait "$child" || status=$?; fi
release
exit "$status"
