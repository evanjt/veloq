# Sourced, never run: sets `VELOQ_DEVICE_LOCK_PATH` to the lock for the handset
# this run will reach. Two scripts take that lock, `with-device-lock.sh` around
# one command and `device-lock-shell.sh` around a whole hand-driven session, and
# they have to agree on the path or neither serialises the other.

# A fixed path, never one the environment chooses: a session with its own temp
# directory would take a lock nobody else can see, which is the same as no lock
# at all. `VELOQ_DEVICE_LOCK_DIR` is for the tests that prove the path is
# derived from the serial: deriving it under the machine's directory queues them
# behind whatever the fleet is measuring on a handset of that serial.
if [ -n "${VELOQ_DEVICE_LOCK_DIR:-}" ]; then
  _veloq_lock_dir="$VELOQ_DEVICE_LOCK_DIR"
else
  _veloq_lock_dir="/tmp/claude-$(id -u)"
  [ -d "$_veloq_lock_dir" ] || _veloq_lock_dir="/tmp"
fi

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
# Taking whichever handset `adb devices` lists first then holds one phone's
# lock while driving the other. So the ambiguity is reported and the takers
# refuse.
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
# right: a run can hold one handset's lock and drive another.
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

# The lock for Maestro across the whole host, whichever device a run drives.
# Maestro reaches its on-device driver through a forward of one fixed host
# port and takes no option to move it, so two runs on two devices of one host
# take the forward from each other and every flow on both fails. It sits beside
# the device lock, so a test that moves the device lock moves this one too.
VELOQ_MAESTRO_LOCK_PATH="${VELOQ_MAESTRO_LOCK:-$(dirname "$VELOQ_DEVICE_LOCK_PATH")/veloq-maestro.lock}"
export VELOQ_MAESTRO_LOCK_PATH

# The lock for booting an emulator, one per host. Two emulators, at 3.4 GB and
# 0.8 GB, beside one native build pushed a 31 GB host into 16 GB of swap, so a
# host runs one and every session that wants one reuses it.
VELOQ_EMULATOR_LOCK_PATH="${VELOQ_EMULATOR_LOCK:-$(dirname "$VELOQ_DEVICE_LOCK_PATH")/veloq-emulator.lock}"
export VELOQ_EMULATOR_LOCK_PATH

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

# Automated device work runs on an emulator or on a handset designated for
# testing, never on whatever phone happens to be attached: the rigs behind this
# lock uninstall the app and clear its data, so landing on someone's own phone
# wipes a real library. A run that means to use another handset names its
# serial in `VELOQ_ALLOW_HANDSET`, which admits that serial and no other, so an
# override left exported in a shell does not carry over to a different phone.
#
# The test handsets are `VELOQ_TEST_HANDSETS`, serials separated by whitespace,
# or else the file below, one serial per line with `#` comments. The file sits
# outside the repository because a gitignored file is missing from every
# worktree, and because a handset's serial does not belong in the repository.
# With neither, only emulators and simulators pass.
#
# It reads only the serial derived above and sends nothing to the handset, so a
# refused phone receives no command at all. An explicit `VELOQ_DEVICE_LOCK`
# changes where the lock lives and not which handset is reached, so it does not
# bypass this. Nothing attached passes, since there is no handset to protect.
veloq_refuse_if_not_test_device() {
  _veloq_reached="${VELOQ_DEVICE_SERIAL:-}"
  [ -n "$_veloq_reached" ] || return 0
  case "$_veloq_reached" in
  emulator-*) return 0 ;;
  esac
  # An iOS simulator, whose UDID is a UUID, is an emulator too. A physical
  # iPhone's UDID has another shape, so it is held to the allowlist.
  if printf '%s\n' "$_veloq_reached" |
    grep -qxE '[0-9A-Fa-f]{8}-([0-9A-Fa-f]{4}-){3}[0-9A-Fa-f]{12}'; then
    return 0
  fi
  [ "${VELOQ_ALLOW_HANDSET:-}" != "$_veloq_reached" ] || return 0

  _veloq_file="${XDG_CONFIG_HOME:-${HOME:-}/.config}/veloq/test-handsets"
  if [ -n "${VELOQ_TEST_HANDSETS:-}" ]; then
    _veloq_from=VELOQ_TEST_HANDSETS
    _veloq_listed=$VELOQ_TEST_HANDSETS
  else
    _veloq_from=$_veloq_file
    _veloq_listed=""
    [ ! -r "$_veloq_file" ] || _veloq_listed=$(sed 's/#.*//' "$_veloq_file")
  fi
  if printf '%s\n' "$_veloq_listed" | tr -s ' \t' '\n\n' | grep -qxF -- "$_veloq_reached"; then
    return 0
  fi

  echo "$1: the run would reach $_veloq_reached, which is not a test handset." >&2
  echo "$1: test handsets are read from $_veloq_from; emulators and simulators always pass." >&2
  echo "$1: list it there, or admit it for this run only with" >&2
  echo "$1:   VELOQ_ALLOW_HANDSET=$_veloq_reached" >&2
  return 1
}

# The one ABI a device build compiles for: the primary ABI of the handset this
# run will reach, or arm64-v8a when none answers. A device build left to the
# generated default of four ABIs compiles the engine and every native library
# four times over to install on a handset that loads one; release artefacts are
# not device builds and keep the default.
#
# Like `adb devices` above it is a read, made while choosing, and it goes only to
# a handset the lock would admit: a phone that is not a test handset, or a choice
# between several, is never asked and gets the fallback.
veloq_device_abi() {
  _veloq_abi=""
  if [ -n "${VELOQ_DEVICE_SERIAL:-}" ] && [ -z "${VELOQ_DEVICE_LOCK_AMBIGUOUS:-}" ] &&
    veloq_refuse_if_not_test_device device-abi 2>/dev/null; then
    _veloq_abi=$(ANDROID_SERIAL=$VELOQ_DEVICE_SERIAL adb shell getprop ro.product.cpu.abi 2>/dev/null |
      tr -d '\r' | head -1 || true)
  fi
  # Only an ABI the build targets; anything else would fail a quarter of an
  # hour into the build rather than here.
  case "$_veloq_abi" in
  armeabi-v7a | arm64-v8a | x86 | x86_64) ;;
  *)
    [ -z "$_veloq_abi" ] || echo "device-abi: the handset reports $_veloq_abi, building arm64-v8a" >&2
    _veloq_abi=arm64-v8a
    ;;
  esac
  echo "$_veloq_abi"
  unset _veloq_abi
}
