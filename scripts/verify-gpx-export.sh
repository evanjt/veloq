#!/usr/bin/env bash
# Pull the most recent GPX export from the emulator and validate it against
# demo-test-0's Swiss Alps fixture. Run after the matching Maestro flow.
#
# Requirements: adb in PATH, a running emulator with com.veloq.app.dev.
set -uo pipefail

PKG="com.veloq.app.dev"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

NEWEST=$(adb shell "run-as $PKG ls -1t cache/" 2>/dev/null | tr -d '\r' | grep -E '\.gpx$' | head -n1 || true)
if [ -z "${NEWEST:-}" ]; then
  echo "FAIL: no .gpx file in cache/ — did the export flow run?"
  exit 1
fi
echo "Found: $NEWEST"

adb shell "run-as $PKG cat cache/$NEWEST" > "$WORK/export.gpx"
SIZE=$(stat -c%s "$WORK/export.gpx")
echo "Pulled $SIZE bytes"

if [ "$SIZE" -lt 500 ]; then
  echo "FAIL: file too small ($SIZE bytes)"
  exit 1
fi

if ! grep -q '<?xml' "$WORK/export.gpx"; then
  echo "FAIL: not valid XML"
  exit 1
fi

TRKPT=$(grep -c '<trkpt' "$WORK/export.gpx" || true)
if [ "$TRKPT" -lt 10 ]; then
  echo "FAIL: only $TRKPT trkpt entries"
  exit 1
fi

# Swiss Alps bbox check using min/max across all points.
LAT_STATS=$(grep -oE 'lat="[0-9.]+"' "$WORK/export.gpx" | sed 's/lat="//;s/"//' | awk 'NR==1{min=max=$1} {if($1<min)min=$1; if($1>max)max=$1} END{print min" "max}')
LON_STATS=$(grep -oE 'lon="[0-9.]+"' "$WORK/export.gpx" | sed 's/lon="//;s/"//' | awk 'NR==1{min=max=$1} {if($1<min)min=$1; if($1>max)max=$1} END{print min" "max}')

LAT_MIN=$(echo "$LAT_STATS" | awk '{print $1}')
LAT_MAX=$(echo "$LAT_STATS" | awk '{print $2}')
LON_MIN=$(echo "$LON_STATS" | awk '{print $1}')
LON_MAX=$(echo "$LON_STATS" | awk '{print $2}')

echo "Bounds: lat $LAT_MIN–$LAT_MAX, lon $LON_MIN–$LON_MAX"

OK=$(awk -v latmin="$LAT_MIN" -v latmax="$LAT_MAX" -v lonmin="$LON_MIN" -v lonmax="$LON_MAX" 'BEGIN {
  if (latmin >= 45.5 && latmax <= 48.0 && lonmin >= 5.5 && lonmax <= 10.5) print "yes"; else print "no"
}')

if [ "$OK" != "yes" ]; then
  echo "FAIL: coordinates outside Swiss Alps bbox (45.5–48.0 N, 5.5–10.5 E)"
  exit 1
fi

echo "PASS: $TRKPT trackpoints, Swiss Alps bbox, $SIZE bytes"
