#!/usr/bin/env bash
# Times the heatmap's under-point read and the group draw on the handset.
#
# Run `.maestro/measure/under-point-setup.yaml` first (demo mode, Debug Mode, the
# heatmap on, the Rio run framed). This script then taps the dense line three
# times per zoom and, for each tap, prints the engine's own timings from logcat and the frame
# histogram of the group draw. The export's mean and max come from the
# Developer Dashboard's FFI table afterwards.
#
# The handset cannot pinch from `adb`, so the zoom asked for is the one the
# build under test forces on the lookup. The zooms listed here label the taps.
#
# Usage: scripts/measure-under-point.sh LABEL [ZOOMS...]   (zooms 14 12 by default)

set -eu
if [ -z "${VELOQ_DEVICE_LOCK_HELD:-}" ]; then
  exec "$(dirname "$0")/with-device-lock.sh" "$0" "$@"
fi

PKG=com.veloq.app.dev
LABEL=${1:?label}
shift || true
ZOOMS=${*:-14 12}
TAP_X=388
TAP_Y=1170
ROW_X=540
ROW_Y=1827
TAPS=3

a() { adb ${ANDROID_SERIAL:+-s "$ANDROID_SERIAL"} "$@"; }

focused() { a shell dumpsys window | grep -q "mCurrentFocus.*$PKG"; }

engine_lines() { a logcat -d -s veloqrs | grep 'UnderPoint' | sed 's/.*\[UnderPoint\] //'; }

jank() {
  awk '/Total frames/ {t=$4} /Janky frames:/ {j=$3" "$4} /^90th percentile/ {p=$3} /^99th percentile/ {q=$3}
       END {print "frames " t ", janky " j ", p90 " p ", p99 " q}'
}

focused || { echo "Veloq is not in front" >&2; exit 1; }
for zoom in $ZOOMS; do
  for n in $(seq 1 "$TAPS"); do
    a logcat -c
    a shell input tap "$TAP_X" "$TAP_Y"
    sleep 2.5
    a shell "dumpsys gfxinfo $PKG reset >/dev/null; input tap $ROW_X $ROW_Y; sleep 3; dumpsys gfxinfo $PKG" >/tmp/under-point-gfx.txt
    focused || { echo "Veloq lost focus" >&2; exit 1; }
    echo "$LABEL zoom $zoom tap $n:"
    engine_lines | sed 's/^/  /'
    echo "  draw $(jank </tmp/under-point-gfx.txt)"
    a shell input keyevent KEYCODE_BACK
    sleep 2
  done
done

# The export's row of the Developer Dashboard's FFI table: calls, mean, max, p95.
a shell am start -a android.intent.action.VIEW -d veloq:///debug "$PKG" >/dev/null
sleep 4
for _ in 1 2 3 4 5 6 7 8; do
  a shell "uiautomator dump /sdcard/under-point.xml >/dev/null; cat /sdcard/under-point.xml" >/tmp/under-point-ui.xml
  if python3 -I - /tmp/under-point-ui.xml "$LABEL" <<'PY'
import re, sys
texts = re.findall(r'text="([^"]*)"', open(sys.argv[1]).read())
names = [i for i, t in enumerate(texts) if t == "getActivitiesUnderPoint"]
if not names:
    sys.exit(1)
i = names[0]
print(f"{sys.argv[2]} FFI getActivitiesUnderPoint: calls {texts[i+1]}, mean {texts[i+2]} ms, max {texts[i+3]} ms, p95 {texts[i+4]} ms")
PY
  then break; fi
  a shell input swipe 540 1700 540 700 200
  sleep 1
done
a shell rm -f /sdcard/under-point.xml
a shell input keyevent KEYCODE_BACK
