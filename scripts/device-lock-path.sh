# Sourced, never run: sets `VELOQ_DEVICE_LOCK_PATH` to the lock for the handset
# this run will reach. Two scripts take that lock, `with-device-lock.sh` around
# one command and `device-lock-shell.sh` around a whole hand-driven session, and
# they have to agree on the path or neither serialises the other.

# A fixed path, never one the environment chooses: a session with its own temp
# directory would take a lock nobody else can see, which is the same as no lock
# at all.
_veloq_lock_dir="/tmp/claude-$(id -u)"
[ -d "$_veloq_lock_dir" ] || _veloq_lock_dir="/tmp"

# The serial the run will reach. `ANDROID_SERIAL` is what `adb` itself reads,
# so a run pinned to one handset locks that handset. With nothing set and one
# device attached, that device is the one, and its serial is what everybody
# else derives too.
#
# With several attached and nothing set there is no answer, and taking the
# first is worse than taking none: it reads as serialised. This said `adb`
# refuses anyway so the name only had to be stable, and that is true of a bare
# `adb` call and not of how the wrappers are used. The lock is taken outside
# and the serial is chosen inside, by `adb -s`, by an `ANDROID_SERIAL` the
# inner shell exports, or by Maestro's `--device`; then `adb` never refuses.
# On 2026-09-19 a session drove the S22 for an hour holding the OnePlus's lock,
# because `adb devices` happened to list the OnePlus first. So the
# ambiguity is reported and the takers refuse.
_veloq_serial="${ANDROID_SERIAL:-}"
VELOQ_DEVICE_LOCK_AMBIGUOUS=""
if [ -z "$_veloq_serial" ] && command -v adb >/dev/null 2>&1; then
  _veloq_attached=$(adb devices | awk '$2 == "device" { print $1 }')
  _veloq_count=$(printf '%s\n' "$_veloq_attached" | grep -c '[^[:space:]]' || true)
  if [ "$_veloq_count" -gt 1 ]; then
    VELOQ_DEVICE_LOCK_AMBIGUOUS=$(printf '%s' "$_veloq_attached" | tr '\n' ' ')
  fi
  _veloq_serial=$(printf '%s\n' "$_veloq_attached" | head -1)
  unset _veloq_attached _veloq_count
fi
# The serial itself, unsanitised, for a caller that has to name the handset to
# something other than `adb`. Maestro is that caller: it chooses a transport
# itself when it is not told, so the lock being right does not make the run
# right, and on 2026-09-20 a session locked the S22 and drove the OnePlus.
# Empty when nothing is attached, since there is nothing to name.
VELOQ_DEVICE_SERIAL="$_veloq_serial"
export VELOQ_DEVICE_SERIAL

[ -n "$_veloq_serial" ] || _veloq_serial=unset
# A serial carries a colon on a network device and adb allows more besides, so
# anything that is not a filename character becomes one.
_veloq_serial=$(printf '%s' "$_veloq_serial" | tr -c 'A-Za-z0-9._-' '_')

# The override is for the tests that prove this serialises: a test taking the
# real lock would queue behind whatever the fleet is measuring.
VELOQ_DEVICE_LOCK_PATH="${VELOQ_DEVICE_LOCK:-$_veloq_lock_dir/veloq-device-$_veloq_serial.lock}"
export VELOQ_DEVICE_LOCK_PATH

# An explicit path is an answer, so the ambiguity above no longer matters.
[ -z "${VELOQ_DEVICE_LOCK:-}" ] || VELOQ_DEVICE_LOCK_AMBIGUOUS=""
export VELOQ_DEVICE_LOCK_AMBIGUOUS

# Both takers call this before they lock anything.
veloq_refuse_if_ambiguous() {
  [ -n "${VELOQ_DEVICE_LOCK_AMBIGUOUS:-}" ] || return 0
  echo "$1: several handsets attached and no ANDROID_SERIAL:" >&2
  echo "$1:   $VELOQ_DEVICE_LOCK_AMBIGUOUS" >&2
  echo "$1: set ANDROID_SERIAL to the one you mean, or the lock names a phone" >&2
  echo "$1: you are not driving and serialises nothing (B1176)." >&2
  return 1
}
