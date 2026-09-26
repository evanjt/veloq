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
# Maestro 2.1.0 (`B1165`).
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
# everything (`B1165`). So a run locked to one phone drove the other, with every
# `adb` call in the same shell reaching the locked one, which reads as the lock
# working (`B1208`). The serial comes from the same file the lock derives its
# path from, so the phone that is locked is the phone that is driven.
. "$(dirname "$0")/device-lock-path.sh"
veloq_refuse_if_ambiguous with-maestro || exit 1

# A device the caller named is the answer already, and passing a second
# `--device` would leave which one wins to Maestro.
for arg in "$@"; do
  case "$arg" in
  --device | --udid) exec maestro "$@" ;;
  esac
done

[ -n "${VELOQ_DEVICE_SERIAL:-}" ] || exec maestro "$@"

# `--device` is a global flag, so it goes ahead of the subcommand.
exec maestro --device "$VELOQ_DEVICE_SERIAL" "$@"
