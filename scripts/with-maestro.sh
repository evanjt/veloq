#!/usr/bin/env sh
# Run Maestro against the handset, one flow at a time, and refuse early when
# `adb` holds a transport Maestro cannot work around.
#
# Maestro enumerates every transport rather than the one it was asked for, so a
# single entry stuck at `offline` makes it refuse the healthy handset by name:
# with the OnePlus offline and the S22 connected, `maestro --device
# 192.168.1.118:5555 test ...` answered "Device 192.168.1.118:5555 was
# requested, but it is not connected", which reads as the S22 having dropped.
# `--udid`, `-p android` and `ANDROID_SERIAL` all behaved the same way, and
# `adb -s 192.168.1.118:5555 shell` worked throughout. Measured 2026-09-19 on
# Maestro 2.1.0.
#
# So the preflight says what the run actually met. Clearing it is `adb
# disconnect <serial>`, which did not always take here: a transport that will
# not go needs the `adb` server restarted, `adb kill-server`.

set -eu

# The handset lock, for the reason every other driver takes it: a flow's
# `launchApp` force-stops the app and `clearState` wipes its data, so a flow
# does not share the handset, it resets it.
if [ -z "${VELOQ_DEVICE_LOCK_HELD:-}" ]; then
  exec "$(dirname "$0")/with-device-lock.sh" "$0" "$@"
fi

if command -v adb >/dev/null 2>&1; then
  offline=$(adb devices 2>/dev/null | awk '$2 == "offline" { print $1 }')
  if [ -n "$offline" ]; then
    echo "with-maestro: adb holds an offline transport:" >&2
    for serial in $offline; do
      echo "with-maestro:   $serial" >&2
    done
    echo "with-maestro: Maestro enumerates every transport, so it refuses every device" >&2
    echo "with-maestro: while one is offline, naming the healthy one as not connected." >&2
    echo "with-maestro: clear it with 'adb disconnect <serial>', or 'adb kill-server'" >&2
    echo "with-maestro: when disconnect will not take." >&2
    exit 1
  fi
fi

# Which handset the flow reaches. Maestro chooses a transport itself when it is
# not told, and `ANDROID_SERIAL` does not hold it: that steers `adb`, and
# Maestro's own selection reads it the way it reads `--device`, by enumerating
# everything. So a run locked to one phone drove the other, with every
# `adb` call in the same shell reaching the locked one, which reads as the lock
# working. The serial comes from the same file the lock derives its
# path from, so the phone that is locked is the phone that is driven.
. "$(dirname "$0")/device-lock-path.sh"
veloq_refuse_if_ambiguous with-maestro || exit 1

# The run drives the serial it holds the lock for, and no other. A caller may
# name that serial again with `--device` or `--udid`, but a selector that names
# a different device, or names none, is refused: the lock would serialise one
# handset while Maestro drove another. Every occurrence is checked, so a later
# matching selector cannot hide an earlier mismatch.
expected=${VELOQ_DEVICE_SERIAL:-}
named=""
previous=""
check_selector() {
  named=1
  if [ -z "$1" ]; then
    echo "with-maestro: --device and --udid need a serial, and one was given empty or missing." >&2
    exit 1
  fi
  if [ "$1" != "$expected" ]; then
    echo "with-maestro: the caller asked for $1 but the run is locked to ${expected:-no device}." >&2
    echo "with-maestro: set ANDROID_SERIAL to $1 to lock that handset instead." >&2
    exit 1
  fi
}
for arg in "$@"; do
  case "$previous" in
  --device | --udid) check_selector "$arg" ;;
  esac
  case "$arg" in
  --device=* | --udid=*) check_selector "${arg#*=}" ;;
  esac
  previous=$arg
done
case "$previous" in
--device | --udid) check_selector "" ;;
esac

if [ -z "$named" ] && [ -n "$expected" ]; then
  # `--device` is a global flag, so it goes ahead of the subcommand.
  set -- --device "$expected" "$@"
fi

# The serials this run must not land on: every other attached transport.
others=""
if [ -n "$expected" ] && command -v adb >/dev/null 2>&1; then
  others=$(adb devices 2>/dev/null | awk -v want="$expected" '$2 == "device" && $1 != want { print $1 }')
fi
[ -n "$others" ] || exec maestro "$@"

# Being handed `--device` is not the same as using it: Maestro's own selection
# has read `ANDROID_SERIAL` by enumerating every transport, and it shards a run
# across everything attached when it is given nothing. So the run is watched,
# and once Maestro names another attached handset as the one it is on, it is
# stopped before the flow does anything there. A line that names no attached
# serial says nothing either way and is let through.
fifo=$(mktemp -u "${TMPDIR:-/tmp}/with-maestro.XXXXXX")
mkfifo "$fifo"
# An asynchronous command gets /dev/null for its input when job control is off,
# so the caller's input is handed down on a descriptor of its own.
exec 3<&0
maestro "$@" <&3 3<&- >"$fifo" &
pid=$!
exec 3<&-
# An asynchronous command also ignores an interrupt, so it is passed on.
trap 'kill "$pid" 2>/dev/null; rm -f "$fifo"; exit 130' INT TERM HUP

landed=""
while IFS= read -r line || [ -n "$line" ]; do
  printf '%s\n' "$line"
  case "$line" in
  *"Running on "* | *"Selected device "*)
    case "$line" in
    *"$expected"*) ;;
    *)
      for serial in $others; do
        case "$line" in
        *"$serial"*)
          landed=$serial
          break
          ;;
        esac
      done
      ;;
    esac
    ;;
  esac
  [ -z "$landed" ] || break
done <"$fifo"

if [ -n "$landed" ]; then
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  rm -f "$fifo"
  echo "with-maestro: Maestro was asked for $expected and is running on $landed." >&2
  echo "with-maestro: the run is stopped. Detach $landed or set ANDROID_SERIAL to it" >&2
  echo "with-maestro: if that is the handset you mean." >&2
  exit 1
fi

rm -f "$fifo"
status=0
wait "$pid" || status=$?
exit "$status"
