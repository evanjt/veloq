#!/bin/bash
# Measure janky frames on the home feed: `measure-feed-jank.sh LABEL APK N`.
#
# Three ways a run goes wrong and none of them fails loudly. A relaunch can
# land on a login screen, since demo mode does not survive one, so the swipes
# measure a screen that renders few frames and almost none of them janky, and
# that reads as a very good result. A return swipe taken while the feed is already at the top pulls the
# notification shade down, and every swipe after it goes to the shade. And
# maestro's own `launchApp` reports "Unable to launch app" against a freshly
# reinstalled build while `adb shell am start` launches it fine. Each is
# checked rather than assumed, and a run that fails a check is discarded and
# retried rather than averaged in.
#
# **Discard the first run after entry.** It is a warm-up, not a measurement:
# the feed is still fetching previews and computing insights, and it reads four
# to five times the settled figure. Measured 2026-09-13 over eight runs of one
# build: run one 6.34 per cent, runs two to eight 1.51 to 1.86, a spread of
# 0.35 points. Averaging run one in is what made four earlier before-and-after
# blocks disagree by ten points and say nothing about the change under test.
#
# Either library is measured. A login screen is walked into demo mode, and a
# handset already signed in is measured on its own library, since entering demo
# there would sign that session out. Every line names the library, and a set
# whose library changes between two entries is refused: runs over two libraries
# are not one measurement.
set -u

# The handset driven is the handset locked. `DEVICE` is still taken, as the
# name of that handset, and it becomes the serial the lock is taken on. Naming
# two different phones is refused: the lock would sit on one while the
# installs and the `gfxinfo` resets went to the other.
if [ -n "${DEVICE:-}" ]; then
  if [ -n "${ANDROID_SERIAL:-}" ] && [ "$ANDROID_SERIAL" != "$DEVICE" ]; then
    echo "measure-feed-jank: DEVICE=$DEVICE and ANDROID_SERIAL=$ANDROID_SERIAL name two handsets." >&2
    echo "measure-feed-jank: set one of them." >&2
    exit 2
  fi
  ANDROID_SERIAL=$DEVICE
  export ANDROID_SERIAL
fi

# One measurement at a time against one handset: `docket start` locks the item
# and not the phone, and a second session resetting or relaunching the app
# mid-run lands in this run's numbers. Re-exec through the lock unless
# it is already held, so running this by hand takes it too.
if [ -z "${VELOQ_DEVICE_LOCK_HELD:-}" ]; then
  exec "$(dirname "$0")/with-device-lock.sh" "$0" "$@"
fi

D=${VELOQ_DEVICE_SERIAL:-${ANDROID_SERIAL:-}}
if [ -z "$D" ]; then
  echo "measure-feed-jank: no handset attached, or none named." >&2
  exit 2
fi
if [ -n "${DEVICE:-}" ] && [ "$DEVICE" != "$D" ]; then
  echo "measure-feed-jank: DEVICE=$DEVICE but the lock held is for $D." >&2
  exit 2
fi
PKG=com.veloq.app.dev
RIG=$(dirname "$0")/../.maestro/jank
FLOOR=${FLOOR:-2800}
LABEL=
LIBRARY=

mo() { "$(dirname "$0")/with-maestro.sh" --device "$D" test "$1" >/dev/null 2>&1; }

enter() {
  adb -s "$D" shell input keyevent KEYCODE_BACK >/dev/null 2>&1
  adb -s "$D" shell am force-stop "$PKG" >/dev/null 2>&1
  adb -s "$D" shell am start -n "$PKG/$PKG.MainActivity" >/dev/null 2>&1
  sleep 8
  mo "$RIG/enter.yaml" || return 1
  local now
  if mo "$RIG/demo-library.yaml"; then
    now=demo
  elif mo "$RIG/signed-in-library.yaml"; then
    now=signed-in
  else
    return 1
  fi
  if [ -z "$LIBRARY" ]; then
    LIBRARY=$now
  elif [ "$now" != "$LIBRARY" ]; then
    echo "$LABEL REFUSED: the set began on library=$LIBRARY and this entry is on library=$now"
    exit 1
  fi
}

focused() {
  adb -s "$D" shell dumpsys window 2>/dev/null | grep -q "mCurrentFocus.*$PKG/"
}

# One run, or nothing when the state was not right before or after it.
one() {
  focused || return 1
  mo "$RIG/guard.yaml" || return 1
  adb -s "$D" shell dumpsys gfxinfo "$PKG" reset >/dev/null 2>&1
  mo "$RIG/scroll.yaml"
  focused || return 1
  mo "$RIG/guard.yaml" || return 1
  local out total janky
  out=$(adb -s "$D" shell dumpsys gfxinfo "$PKG" 2>/dev/null | tr -d '\r')
  total=$(echo "$out" | sed -n 's/^Total frames rendered: \([0-9]*\)/\1/p')
  janky=$(echo "$out" | sed -n 's/^Janky frames: \([0-9]*\) (\([0-9.]*\)%)/\1 \2/p')
  [ -n "$total" ] && [ "$total" -ge "$FLOOR" ] || return 1
  echo "$total $janky"
}

# The first run after an entry is a warm-up, so it is printed and never counted.
warm_up() {
  local line
  if line=$(one); then
    echo "$1 warm-up  library=$LIBRARY  frames=$(echo "$line" | cut -d' ' -f1)  janky=$(echo "$line" | cut -d' ' -f2)  pct=$(echo "$line" | cut -d' ' -f3)"
  else
    echo "$1 warm-up failed its checks"
    return 1
  fi
}

ready_after_entry() {
  local label=$1 attempt=1
  while [ "$attempt" -le 3 ]; do
    if warm_up "$label"; then
      return 0
    fi
    if [ "$attempt" -lt 3 ]; then
      enter || { echo "$label ENTRY FAILED"; return 1; }
    fi
    attempt=$((attempt + 1))
  done
  echo "$label WARM-UP FAILED"
  return 1
}

# `set LABEL APK N` installs, enters, and prints N good runs after a warm-up.
set_runs() {
  local label=$1 apk=$2 want=$3 got=0 tries=0 line
  LABEL=$label
  # --stale because the before and after builds are cut from other commits on
  # purpose. The stamp it prints keeps the pair readable.
  ANDROID_SERIAL=$D "$(dirname "$0")/install-apk.sh" "$apk" --stale >&2 || { echo "$label INSTALL FAILED"; return 1; }
  enter || { echo "$label ENTRY FAILED"; return 1; }
  ready_after_entry "$label" || return 1
  while [ "$got" -lt "$want" ] && [ "$tries" -lt $((want * 3)) ]; do
    tries=$((tries + 1))
    if line=$(one); then
      got=$((got + 1))
      echo "$label $got  library=$LIBRARY  frames=$(echo "$line" | cut -d' ' -f1)  janky=$(echo "$line" | cut -d' ' -f2)  pct=$(echo "$line" | cut -d' ' -f3)"
    else
      echo "$label discarded (attempt $tries)"
      enter || { echo "$label ENTRY FAILED"; return 1; }
      ready_after_entry "$label" || return 1
    fi
  done
  [ "$got" -eq "$want" ] || { echo "$label SHORT: $got of $want"; return 1; }
}

if [ $# -ne 3 ]; then
  echo "usage: $(basename "$0") LABEL APK RUNS" >&2
  echo "  ANDROID_SERIAL=<serial> names the handset, FLOOR=<frames> the frame floor." >&2
  exit 2
fi

set_runs "$@"
