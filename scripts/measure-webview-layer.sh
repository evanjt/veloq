#!/bin/sh
# Reads GPU memory and frame times for the feed, the 2D map tab and the 3D map
# tab from a cold start, for comparing WebView layer types. The app must load its
# JavaScript from a Metro server on port 8081, so the layer type can be changed
# between runs without a native build. It takes the device lock itself, so
# export ANDROID_SERIAL first.
#
#   scripts/measure-webview-layer.sh <label> <output dir>
set -eu

if [ -z "${VELOQ_DEVICE_LOCK_HELD:-}" ]; then
  exec "$(dirname "$0")/with-device-lock.sh" "$0" "$@"
fi

label=$1
out=$2
pkg=com.veloq.app.dev
mkdir -p "$out"

tap() { adb shell input tap "$1" "$2"; }
swipes() {
  for i in 1 2 3 4; do
    adb shell input swipe "$1" "$2" "$3" "$4" 600
    adb shell input swipe "$3" "$4" "$1" "$2" 600
  done
}
read_state() {
  adb shell dumpsys gfxinfo "$pkg" > "$out/$label-$1-gfx.txt"
  adb shell dumpsys meminfo "$pkg" > "$out/$label-$1-mem.txt"
}
foreground() {
  adb shell dumpsys window | grep mCurrentFocus | grep -q "$pkg/" || {
    echo "Veloq is not in front, stopping" >&2
    exit 1
  }
}

adb reverse tcp:8081 tcp:8081 > /dev/null
adb shell am force-stop "$pkg"
adb shell monkey -p "$pkg" -c android.intent.category.LAUNCHER 1 > /dev/null 2>&1
sleep 40
foreground

adb shell dumpsys gfxinfo "$pkg" reset > /dev/null
swipes 540 1700 540 700
sleep 2
read_state feed

adb shell am start -a android.intent.action.VIEW -d veloq://map "$pkg" > /dev/null 2>&1
sleep 12
foreground
adb shell dumpsys gfxinfo "$pkg" reset > /dev/null
swipes 700 1100 300 700
sleep 2
read_state map2d

tap 971 322
sleep 12
foreground
adb shell dumpsys gfxinfo "$pkg" reset > /dev/null
swipes 700 1100 300 700
sleep 2
read_state map3d
adb exec-out screencap -p > "$out/$label-map3d.png"

for f in "$out/$label"-*-gfx.txt; do
  scene=$(basename "$f" -gfx.txt)
  mem=$out/$scene-mem.txt
  rt=$(grep -A3 'Scratch:' "$f" | grep RenderTarget | sed 's/^ *//')
  gpu=$(grep -A1 'Total GPU memory usage' "$f" | tail -1 | sed 's/^ *//')
  gl=$(grep 'GL mtrack' "$mem" | awk '{print $3}')
  gfx=$(grep 'Graphics:' "$mem" | awk '{print $2}')
  p50=$(grep '^50th percentile' "$f" | awk '{print $3}')
  p90=$(grep '^90th percentile' "$f" | awk '{print $3}')
  p99=$(grep '^99th percentile' "$f" | awk '{print $3}')
  jank=$(grep '^Janky frames:' "$f" | awk '{print $3, $4}')
  frames=$(grep '^Total frames rendered' "$f" | awk '{print $4}')
  echo "$scene | scratch $rt | gpu $gpu | GL mtrack ${gl}K | Graphics ${gfx}K | frames $frames p50 $p50 p90 $p90 p99 $p99 jank $jank"
done
