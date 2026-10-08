#!/bin/bash
# Time the recording save tap's JavaScript legs in the handset's own Hermes:
# `measure-recording-save.sh OUT [hbc]`.
#
# The save tap builds the FIT file and its base64 on the JS thread; the engine
# write that follows reads the track out of the FIT on a worker. The two JS
# legs are what can hold the thread past a tap's budget, and a desktop engine
# says nothing about how long they take on a phone.
#
# The installed debug build is pointed at a server on this host for one launch,
# which hands it `measure-recording-save-bundle.mjs`'s bundle in place of the
# app: a three-hour ride, built and encoded once to warm and ROUNDS times
# timed, each round written to logcat. With `hbc` the bundle is compiled with
# `hermesc -O` first, which is how a release build ships its JavaScript.
#
# The app runs nothing else: no sign-in, no sync, no engine. Its dev host and
# its cached dev bundle are put back as they were when the run ends.
set -u

if [ $# -lt 1 ]; then
  echo "usage: $(basename "$0") OUT [hbc]" >&2
  exit 2
fi

HERE=$(cd "$(dirname "$0")" && pwd)
if [ -z "${VELOQ_DEVICE_LOCK_HELD:-}" ]; then
  exec "$HERE/with-device-lock.sh" "$0" "$@"
fi

OUT=$1 FORM=${2:-source}
D=${VELOQ_DEVICE_SERIAL:-${ANDROID_SERIAL:-}}
if [ -z "$D" ]; then
  echo "measure-recording-save: no handset attached, or none named." >&2
  exit 2
fi
PKG=com.veloq.app.dev
PREFS=shared_prefs/${PKG}_preferences.xml
CACHE=files/BridgelessReactNativeDevBundle.js
PORT=${PORT:-18250}
mkdir -p "$OUT"
WORK=$(mktemp -d)

a() { adb -s "$D" "$@"; }
as() { a shell run-as "$PKG" "$@" | tr -d '\r'; }

if ! as true 2>/dev/null; then
  echo "measure-recording-save: $PKG is not a debuggable build on $D." >&2
  exit 2
fi

node "$HERE/measure-recording-save-bundle.mjs" "$WORK/bench.js" || exit 1
BUNDLE=$WORK/bench.js
if [ "$FORM" = hbc ]; then
  "$HERE/../node_modules/hermes-compiler/hermesc/linux64-bin/hermesc" -O -emit-binary \
    -out "$WORK/bench.hbc" "$WORK/bench.js" 2>/dev/null || exit 1
  BUNDLE=$WORK/bench.hbc
fi

node -e '
  const fs = require("fs");
  const body = fs.readFileSync(process.argv[1]);
  require("http").createServer((req, res) => {
    if (req.url.startsWith("/status")) return res.end("packager-status:running");
    if (req.url.includes(".bundle")) {
      res.writeHead(200, { "Content-Type": "application/javascript" });
      return res.end(body);
    }
    res.writeHead(404);
    res.end();
  }).listen(Number(process.argv[2]), "127.0.0.1");
' "$BUNDLE" "$PORT" &
SERVER=$!

as cat "$PREFS" > "$WORK/prefs.xml" 2>/dev/null || : > "$WORK/prefs.xml"
had_cache=0
as ls "$CACHE" >/dev/null 2>&1 && had_cache=1

restore() {
  a shell am force-stop "$PKG"
  a reverse --remove "tcp:$PORT" >/dev/null 2>&1
  as rm -f "$CACHE"
  [ "$had_cache" = 1 ] && as mv "$CACHE.keep" "$CACHE"
  if [ -s "$WORK/prefs.xml" ]; then
    a exec-in run-as "$PKG" sh -c "cat > $PREFS" < "$WORK/prefs.xml"
  else
    as rm -f "$PREFS"
  fi
  kill "$SERVER" 2>/dev/null
  rm -rf "$WORK"
}
trap restore EXIT

a shell am force-stop "$PKG"
[ "$had_cache" = 1 ] && as mv "$CACHE" "$CACHE.keep"
printf '<?xml version='"'"'1.0'"'"' encoding='"'"'utf-8'"'"' standalone='"'"'yes'"'"' ?>\n<map>\n    <string name="debug_http_host">localhost:%s</string>\n</map>\n' "$PORT" |
  a exec-in run-as "$PKG" sh -c "cat > $PREFS"
a reverse "tcp:$PORT" "tcp:$PORT" >/dev/null

{
  echo "device $(a shell getprop ro.product.model | tr -d '\r') form=$FORM"
  echo "load $(a shell cat /proc/loadavg | tr -d '\r')"
  a shell top -b -n 1 -m 5 -o %CPU,ARGS 2>/dev/null | tr -d '\r' | sed -n '5,10p'
  echo "battery $(a shell dumpsys battery | tr -d '\r' | grep -m2 -E '^ *(level|temperature):' | tr -s ' ' | tr '\n' ' ')"
} | tee "$OUT/run-$FORM.txt"

a logcat -c
a shell am start -n "$PKG/.MainActivity" >/dev/null
for _ in $(seq 1 120); do
  sleep 1
  if a logcat -d 2>/dev/null | grep -q '\[save-cost\] \(done\|error\)'; then break; fi
done
a logcat -d 2>/dev/null | grep -o '\[save-cost\].*' | tr -d '\r' | tee -a "$OUT/run-$FORM.txt"
grep -q '\[save-cost\] done' "$OUT/run-$FORM.txt"
