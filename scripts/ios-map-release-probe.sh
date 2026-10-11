#!/usr/bin/env bash
# Take the 3D activity map's page away on the simulator and report whether the
# map comes back when the athlete returns.
#
#   scripts/ios-map-release-probe.sh UDID [warn|kill]...   (both by default)
#
# Runs on a Mac with Xcode, against a booted simulator with the dev build
# installed and showing the 3D map: demo mode, `veloq://activity/demo-test-0`,
# then the `activity-map-3d-toggle`. The probe refuses to start a case unless
# that map is drawn, and a case that passes leaves it drawn for the next.
#
# `warn` backgrounds the app and delivers a memory warning through CoreSimulator,
# the one the Simulate Memory Warning menu sends, while the app still has
# background time, so the map reclaimer releases the page. Returning rebuilds it.
# `kill` ends the page's WebContent process, which is what the system does to it
# under pressure, and the view reloads it. Each case screenshots the map 4 and
# 15 seconds later and passes when the map area holds a drawn map rather than a
# blank page. Exits 1 when a case fails and 2 when the map was not drawn first.

set -euo pipefail

UDID=${1:?booted simulator udid}
if [ -z "${VELOQ_SIM_LOCK_HELD:-}" ]; then
  exec "$(dirname "$0")/with-simulator-lock.sh" "$UDID" "$0" "$@"
fi
shift
if (($#)); then CASES=("$@"); else CASES=(warn kill); fi
BUNDLE=com.veloq.app.dev
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

cat >"$WORK/memwarn.m" <<'OBJC'
#import <Foundation/Foundation.h>
#import <objc/message.h>
#include <dlfcn.h>

int main(int argc, const char **argv) {
  @autoreleasepool {
    if (!dlopen("/Library/Developer/PrivateFrameworks/CoreSimulator.framework/CoreSimulator", RTLD_NOW)) return 1;
    NSError *err = nil;
    id ctx = ((id (*)(id, SEL, id, NSError **))objc_msgSend)(NSClassFromString(@"SimServiceContext"),
      NSSelectorFromString(@"sharedServiceContextForDeveloperDir:error:"), [NSString stringWithUTF8String:argv[2]], &err);
    id set = ((id (*)(id, SEL, NSError **))objc_msgSend)(ctx, NSSelectorFromString(@"defaultDeviceSetWithError:"), &err);
    NSDictionary *devices = ((id (*)(id, SEL))objc_msgSend)(set, NSSelectorFromString(@"devicesByUDID"));
    id device = devices[[[NSUUID alloc] initWithUUIDString:[NSString stringWithUTF8String:argv[1]]]];
    if (!device) return 1;
    ((void (*)(id, SEL))objc_msgSend)(device, NSSelectorFromString(@"simulateMemoryWarning"));
  }
  return 0;
}
OBJC
clang -fobjc-arc -framework Foundation "$WORK/memwarn.m" -o "$WORK/memwarn"

# How many colours the map area holds. A drawn map shows dozens; the blank or
# broken page a failed rebuild leaves shows a handful.
colours() {
  sips -Z 480 "$1" --out "$WORK/small.png" >/dev/null
  python3 -I - "$WORK/small.png" <<'PY'
import struct, sys, zlib

data = open(sys.argv[1], 'rb').read()
pos, idat = 8, b''
while pos < len(data):
    length, kind = struct.unpack('>I4s', data[pos:pos + 8])
    body = data[pos + 8:pos + 8 + length]
    if kind == b'IHDR':
        width, height, depth, colour = struct.unpack('>IIBB', body[:10])
        if depth != 8 or colour not in (2, 6):
            sys.exit('unsupported png: depth %d colour %d' % (depth, colour))
        step = 3 if colour == 2 else 4
    elif kind == b'IDAT':
        idat += body
    pos += 12 + length
raw, stride, rows, prev = zlib.decompress(idat), width * step, [], bytearray(width * step)
for y in range(height):
    f, line = raw[y * (stride + 1)], bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
    for i in range(stride):
        a = line[i - step] if i >= step else 0
        b, c = prev[i], prev[i - step] if i >= step else 0
        if f == 1:
            line[i] = (line[i] + a) & 255
        elif f == 2:
            line[i] = (line[i] + b) & 255
        elif f == 3:
            line[i] = (line[i] + (a + b) // 2) & 255
        elif f == 4:
            p = a + b - c
            pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
            line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
    rows.append(line)
    prev = line
seen = set()
for y in range(int(height * 0.10), int(height * 0.40), 4):
    for x in range(int(width * 0.05), int(width * 0.70), 4):
        r, g, b = rows[y][x * step:x * step + 3]
        seen.add((r >> 4, g >> 4, b >> 4))
print(len(seen))
PY
}

DRAWN=30
failed=0
for case in "${CASES[@]}"; do
  xcrun simctl io "$UDID" screenshot "$WORK/$case-0.png" >/dev/null 2>&1
  n=$(colours "$WORK/$case-0.png")
  if ((n < DRAWN)); then
    echo "error: the 3D map is not drawn before $case ($n colours), open it first" >&2
    exit 2
  fi
  case $case in
    warn)
      xcrun simctl launch "$UDID" com.apple.Preferences >/dev/null
      sleep 1
      "$WORK/memwarn" "$UDID" "$(xcode-select -p)"
      sleep 10
      xcrun simctl launch "$UDID" "$BUNDLE" >/dev/null
      ;;
    kill)
      launchd=$(pgrep -f "launchd_sim .*/Devices/$UDID/")
      page=$(pgrep -n -P "$launchd" -f com.apple.WebKit.WebContent)
      kill -9 "$page"
      ;;
    *)
      echo "error: unknown case $case" >&2
      exit 2
      ;;
  esac
  for at in 4 15; do
    sleep $((at == 4 ? 4 : 11))
    xcrun simctl io "$UDID" screenshot "$WORK/$case-$at.png" >/dev/null 2>&1
    n=$(colours "$WORK/$case-$at.png")
    if ((n >= DRAWN)); then verdict=drawn; else verdict=blank; failed=1; fi
    echo "$case +${at}s: $n colours, $verdict"
  done
done
exit $failed
