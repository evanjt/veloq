#!/bin/sh
# Measure the two 2D map substrates, the WebView and the native MapLibre view,
# in one build and one process family on one handset, against the library the
# dev app already holds.
#
# Run it from a tree whose release APK carries the substrate spike flag:
#
#     ANDROID_SERIAL=<serial> scripts/measure-map-substrates.sh <apk> <out-dir>
#
# For each substrate it takes a cold launch straight to the map tab, the memory
# with the tab shown and hidden, a re-entry, and SurfaceFlinger's frame
# latency under a scripted pan. On the native substrate it then replays the
# crash shapes the rig carries and records whether the process survived each.
# The timing marks are drawn on the map, so every one is a screenshot.
#
# The handset is shared, so the APK installed when the lock is taken is pulled
# first and put back last: another session may have installed its own build
# and still be measuring it.
set -u
# A second session relaunching or reinstalling the app mid-run lands in this
# run's numbers, so re-exec through the device lock unless it is already held.
if [ -z "${VELOQ_DEVICE_LOCK_HELD:-}" ]; then
  exec "$(dirname "$0")/with-device-lock.sh" "$0" "$@"
fi
APK=$1
OUT=$2
PKG=com.veloq.app.dev
mkdir -p "$OUT"
log() { echo "$(date -u +%H:%M:%SZ) $*" | tee -a "$OUT/run.log"; }

focus_is_app() {
  adb shell dumpsys window | grep mCurrentFocus | grep -q "$PKG"
}

shot() {
  if focus_is_app; then
    adb exec-out screencap -p > "$OUT/$1.png"
    log "shot $1"
  else
    log "shot $1 skipped: focus is $(adb shell dumpsys window | grep mCurrentFocus)"
  fi
}

mem() {
  adb shell dumpsys meminfo "$PKG" > "$OUT/mem-$1.txt"
  log "mem $1: $(grep -E 'TOTAL PSS|Graphics:|GL mtrack|EGL mtrack|Native Heap:' "$OUT/mem-$1.txt" | tr -s ' ' | tr '\n' '|')"
}

# Centre of the first node whose text is $1, from a uiautomator dump.
node_centre() {
  adb shell uiautomator dump /sdcard/substrate-ui.xml >/dev/null 2>&1
  adb exec-out cat /sdcard/substrate-ui.xml > "$OUT/ui.xml"
  adb shell rm -f /sdcard/substrate-ui.xml
  python3 - "$OUT/ui.xml" "$1" <<'EOF'
import re, sys
xml = open(sys.argv[1], encoding='utf-8', errors='replace').read()
for node in re.findall(r'<node [^>]*>', xml):
    text = re.search(r' text="([^"]*)"', node)
    rid = re.search(r' resource-id="([^"]*)"', node)
    if (text and text.group(1) == sys.argv[2]) or (rid and rid.group(1) == sys.argv[2]):
        b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', node)
        if b:
            x1, y1, x2, y2 = map(int, b.groups())
            print((x1 + x2) // 2, (y1 + y2) // 2)
            break
EOF
}

tap_text() {
  xy=$(node_centre "$1")
  if [ -z "$xy" ]; then
    log "no node $1"
    return 1
  fi
  # shellcheck disable=SC2086
  adb shell input tap $xy
  log "tap $1 at $xy"
}

alive() {
  adb shell pidof "$PKG" >/dev/null 2>&1
}

frames() {
  name=$1
  adb shell dumpsys SurfaceFlinger --list > "$OUT/layers-$name.txt"
  # Newer builds print each layer as `RequestedLayerState{<name> parentId=...}`,
  # and --latency wants the bare name.
  grep "$PKG" "$OUT/layers-$name.txt" \
    | sed -e 's/^RequestedLayerState{//' -e 's/ parentId=.*$//' -e 's/}$//' \
    | grep -E 'SurfaceView|MainActivity' > "$OUT/app-layers-$name.txt" || true
  adb shell dumpsys SurfaceFlinger --latency-clear >/dev/null 2>&1
  i=0
  while [ $i -lt 6 ]; do
    adb shell input swipe 540 1500 540 900 250
    adb shell input swipe 300 1100 800 1100 250
    i=$((i + 1))
  done
  : > "$OUT/latency-$name.txt"
  while IFS= read -r layer; do
    {
      echo "== $layer"
      # adb reads stdin, which here is the rest of the layer list.
      adb shell dumpsys SurfaceFlinger --latency "'$layer'" < /dev/null
    } >> "$OUT/latency-$name.txt"
  done < "$OUT/app-layers-$name.txt"
  adb shell dumpsys gfxinfo "$PKG" > "$OUT/gfxinfo-$name.txt"
  log "frames $name taken over $(wc -l < "$OUT/app-layers-$name.txt") layers"
}

substrate_now() {
  if [ -n "$(node_centre native)" ]; then echo native
  elif [ -n "$(node_centre webview)" ]; then echo webview
  else echo unknown
  fi
}

cold_map() {
  adb shell am force-stop "$PKG"
  sleep 3
  adb shell am start -W -a android.intent.action.VIEW -d veloq://map "$PKG" > "$OUT/start-$1.txt" 2>&1
  log "start $1: $(grep -E 'TotalTime|WaitTime|Status' "$OUT/start-$1.txt" | tr -s ' ' | tr '\n' '|')"
}

measure() {
  s=$1
  cold_map "$s-cold"
  sleep 25
  shot "$s-cold-marks"
  mem "$s-shown"
  frames "$s-pan"
  shot "$s-after-pan"
  adb shell am start -a android.intent.action.VIEW -d veloq://routes "$PKG" >/dev/null 2>&1
  sleep 15
  mem "$s-hidden"
  adb shell am start -a android.intent.action.VIEW -d veloq://map "$PKG" >/dev/null 2>&1
  sleep 8
  shot "$s-reentry-marks"
  mem "$s-reentry"
}

log "device $(adb shell getprop ro.product.model) serial ${ANDROID_SERIAL:-unset}"
log "load: $(cut -d' ' -f1-3 /proc/loadavg), host mem: $(free -g | awk '/Mem/{print $3"/"$2" GB used"}')"
adb shell dumpsys package "$PKG" | grep -E 'versionName|lastUpdateTime|pkgFlags' > "$OUT/before-package.txt"
RESTORE="$OUT/installed-before.apk"
adb pull "$(adb shell pm path "$PKG" | head -1 | sed 's/^package://' | tr -d '\r')" "$RESTORE" >/dev/null 2>&1
if [ ! -s "$RESTORE" ]; then
  log "could not pull the installed APK, so nothing is installed over it"
  exit 1
fi
log "saved the installed APK, $(wc -c < "$RESTORE") bytes"
scripts/install-apk.sh "$APK" --stale > "$OUT/install.txt" 2>&1 || adb install -r "$APK" >> "$OUT/install.txt" 2>&1
log "install: $(tail -1 "$OUT/install.txt")"

cold_map probe
sleep 20
first=$(substrate_now)
log "substrate at launch: $first"
shot probe

for pass in 1 2; do
  current=$(substrate_now)
  log "pass $pass on $current"
  measure "$current"
  if [ "$current" = native ]; then
    prev=none
    for shape in sparse nan empty unmounted; do
      tap_text "$prev" || true
      prev=$shape
      sleep 6
      if alive; then log "shape $shape: alive"; else log "shape $shape: process gone"; fi
      shot "native-shape-$shape"
      if ! alive; then
        adb logcat -d -b crash > "$OUT/crash-$shape.txt" 2>&1
        cold_map "recover-$shape"
        sleep 15
      fi
    done
    tap_text "$prev" || true
    sleep 2
  fi
  tap_text "$current" || true
  sleep 3
done
log "substrate after passes: $(substrate_now)"
adb logcat -d -b crash > "$OUT/crash-buffer.txt" 2>&1

adb shell am force-stop "$PKG"
adb install -r -d "$RESTORE" > "$OUT/restore.txt" 2>&1
log "restore: $(tail -1 "$OUT/restore.txt")"
adb shell dumpsys package "$PKG" | grep -E 'versionName|lastUpdateTime|pkgFlags' > "$OUT/after-package.txt"
log "done"
