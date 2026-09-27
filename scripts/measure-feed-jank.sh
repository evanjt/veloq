#!/bin/bash
# Measure janky frames on the home feed: `measure-feed-jank.sh LABEL APK N`.
#
# Three ways a run goes wrong and none of them fails loudly. Demo mode does not
# survive a relaunch, so the swipes can land on a login screen, which renders
# few frames and almost none of them janky, and that reads as a very good
# result. A return swipe taken while the feed is already at the top pulls the
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
set -u

# One measurement at a time against one handset: `docket start` locks the item
# and not the phone, and a second session resetting or relaunching the app
# mid-run lands in this run's numbers. Re-exec through the lock unless
# it is already held, so running this by hand takes it too.
if [ -z "${VELOQ_DEVICE_LOCK_HELD:-}" ]; then
  exec "$(dirname "$0")/with-device-lock.sh" "$0" "$@"
fi

D=${DEVICE:-192.168.1.118:5555}
PKG=com.veloq.app.dev
RIG=$(dirname "$0")/../.maestro/jank
FLOOR=${FLOOR:-2800}

mo() { "$(dirname "$0")/with-maestro.sh" --device "$D" test "$1" >/dev/null 2>&1; }

enter() {
  adb -s "$D" shell input keyevent KEYCODE_BACK >/dev/null 2>&1
  adb -s "$D" shell am force-stop "$PKG" >/dev/null 2>&1
  adb -s "$D" shell am start -n "$PKG/$PKG.MainActivity" >/dev/null 2>&1
  sleep 8
  mo "$RIG/enter.yaml"
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

# `set LABEL APK N` installs, enters, and prints N good runs.
set_runs() {
  local label=$1 apk=$2 want=$3 got=0 tries=0 line
  adb -s "$D" install -r "$apk" >/dev/null 2>&1 || { echo "$label INSTALL FAILED"; return 1; }
  enter || { echo "$label ENTRY FAILED"; return 1; }
  while [ "$got" -lt "$want" ] && [ "$tries" -lt $((want * 3)) ]; do
    tries=$((tries + 1))
    if line=$(one); then
      got=$((got + 1))
      echo "$label $got  frames=$(echo "$line" | cut -d' ' -f1)  janky=$(echo "$line" | cut -d' ' -f2)  pct=$(echo "$line" | cut -d' ' -f3)"
    else
      echo "$label discarded (attempt $tries)"
      enter
    fi
  done
  [ "$got" -eq "$want" ] || echo "$label SHORT: $got of $want"
}

if [ $# -ne 3 ]; then
  echo "usage: $(basename "$0") LABEL APK RUNS" >&2
  echo "  DEVICE=<serial> FLOOR=<frames> override the defaults." >&2
  exit 2
fi

set_runs "$@"
