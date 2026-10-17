#!/usr/bin/env sh
# Give this session the host's Android emulator, booting it only when none
# runs, and print its serial.
#
#     serial=$(scripts/boot-emulator.sh <avd> [emulator options...])
#     ANDROID_SERIAL=$serial npm run maestro:smoke
#
# One emulator per host. Two sessions on one host each booted their own, at
# 3.4 GB and 0.8 GB, and beside one native build that left 2 GB available with
# 16 GB in swap. So every boot takes one host-wide lock, held until the
# emulator it launched has finished booting. A second boot started meanwhile
# waits for it, naming who holds it, and then finds the emulator running and
# reuses it rather than launching another.
#
# An emulator already running is reused when it runs the image asked for, or
# when no image is named. One running another image is refused, naming it: a
# second image is a second emulator. Wait for its owner to stop it, or use it.
#
# The lock covers the boot, not the use. Driving the emulator is the device
# lock's work, per serial, and Maestro's host lock is taken by
# `with-maestro.sh`. The emulator outlives this script and is left running for
# the next session, so stopping it is `adb -s <serial> emu kill`.
#
# It launches headless, as CI does. Options after the image are passed to the
# emulator as they are.

set -eu

avd=${1:-}
[ $# -eq 0 ] || shift

. "$(dirname "$0")/device-lock-path.sh"
lock=$VELOQ_EMULATOR_LOCK_PATH
poll=${VELOQ_EMULATOR_POLL:-2}
boot_timeout=${VELOQ_EMULATOR_BOOT_TIMEOUT:-600}

if ! command -v adb >/dev/null 2>&1; then
  echo "boot-emulator: no adb on PATH, so it cannot see what this host runs." >&2
  exit 2
fi

# Without flock nothing keeps a second emulator off the host, which is the one
# thing this script is for, so it refuses rather than booting unlocked.
if [ -z "${VELOQ_EMULATOR_LOCK_HELD:-}" ]; then
  if ! command -v flock >/dev/null 2>&1; then
    echo "boot-emulator: no flock, so nothing keeps a second emulator off this host." >&2
    exit 2
  fi
  if ! flock -n "$lock" true 2>/dev/null; then
    echo "boot-emulator: another session holds the emulator lock, waiting for its boot to end:" >&2
    if [ -s "$lock" ]; then
      echo "boot-emulator:   $(cat "$lock")" >&2
    else
      echo "boot-emulator:   unknown" >&2
    fi
  fi
  VELOQ_EMULATOR_LOCK_HELD=1
  export VELOQ_EMULATOR_LOCK_HELD
  # `-o`: the emulator this launches outlives the boot, and holding the lock's
  # descriptor would hold the lock for as long as the emulator runs.
  exec flock -o "$lock" "$0" "$avd" "$@"
fi

# Every emulator `adb` sees, an `offline` one included: that is one still
# coming up, and it is running all the same.
emulators() {
  adb devices 2>/dev/null | awk '$1 ~ /^emulator-/ && ($2 == "device" || $2 == "offline") { print $1 }'
}

booted() {
  [ "$(adb -s "$1" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]
}

image_of() {
  adb -s "$1" emu avd name 2>/dev/null | head -1 | tr -d '\r'
}

deadline=$(($(date +%s) + boot_timeout))
past_deadline() {
  [ "$(date +%s)" -ge "$deadline" ]
}

running=$(emulators)
if [ -n "$running" ]; then
  # One booted by hand may still be coming up, and its image is unknown until
  # it answers.
  for serial in $running; do
    until booted "$serial" || past_deadline; do sleep "$poll"; done
  done
  for serial in $running; do
    image=$(image_of "$serial")
    if [ -z "$avd" ] || [ "$image" = "$avd" ]; then
      echo "$serial"
      exit 0
    fi
  done
  echo "boot-emulator: this host runs one emulator at a time, and asked for $avd:" >&2
  for serial in $running; do
    echo "boot-emulator:   $serial is running $(image_of "$serial")" >&2
  done
  if [ -s "$lock" ]; then
    echo "boot-emulator: the last boot through this script: $(cat "$lock")" >&2
  fi
  echo "boot-emulator: use it, with no image named or the one it runs, or wait for its" >&2
  echo "boot-emulator: owner to stop it." >&2
  exit 3
fi

if [ -z "$avd" ]; then
  echo "boot-emulator: no emulator runs on this host and no image was named." >&2
  echo "boot-emulator: usage: scripts/boot-emulator.sh <avd> [emulator options...]" >&2
  echo "boot-emulator: 'emulator -list-avds' lists the images." >&2
  exit 2
fi

printf 'pid=%s avd=%s dir=%s since=%s\n' "$$" "$avd" "$PWD" \
  "$(date '+%Y-%m-%dT%H:%M:%S')" >"$lock"

log="$(dirname "$lock")/veloq-emulator.log"
exited="$(dirname "$lock")/veloq-emulator.exit"
rm -f "$exited"
# Its own session, so the caller's terminal closing or an interrupt to this
# script does not take the emulator down with it. Its exit status lands in a
# file, which says it has gone without reading the state of a child the shell
# may not have reaped.
detach=""
command -v setsid >/dev/null 2>&1 && detach=setsid
nohup $detach sh -c 'emulator "$@"; echo "$?" >"$0"' "$exited" \
  -avd "$avd" -no-window -no-audio -no-boot-anim -no-snapshot-save "$@" \
  </dev/null >"$log" 2>&1 &
pid=$!

while :; do
  serial=$(emulators | head -1)
  if [ -n "$serial" ] && booted "$serial"; then
    echo "$serial"
    exit 0
  fi
  # Read again once it has gone: it may have booted between the two reads.
  if [ -f "$exited" ] && ! { serial=$(emulators | head -1) && [ -n "$serial" ] && booted "$serial"; }; then
    : >"$lock"
    echo "boot-emulator: the emulator exited before it booted. The end of $log:" >&2
    tail -n 20 "$log" >&2 || true
    exit 1
  fi
  if past_deadline; then
    : >"$lock"
    [ -z "$serial" ] || adb -s "$serial" emu kill >/dev/null 2>&1 || true
    kill "$pid" 2>/dev/null || true
    echo "boot-emulator: $avd did not boot within ${boot_timeout}s and is stopped. See $log." >&2
    exit 1
  fi
  sleep "$poll"
done
