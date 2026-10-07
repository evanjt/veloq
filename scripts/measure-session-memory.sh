#!/usr/bin/env bash
# Session memory on the handset, by `dumpsys meminfo` category.
#
# A single reading says nothing about retention: what matters is whether a
# category keeps climbing as activities are opened and closed. So the app is
# driven through the tab bar, never deep links, which push routes a person
# would not, and a reading is taken after every lap or interval.
#
#   scripts/measure-session-memory.sh laps <app-id> <laps> <out-dir>
#   scripts/measure-session-memory.sh browse <app-id> <minutes> <every-minutes> <out-dir>
#   scripts/measure-session-memory.sh point <app-id> <port>
#   scripts/measure-session-memory.sh snapshot <app-id> <port> <out.heapsnapshot>
#   scripts/measure-session-memory.sh unpoint <app-id> <port>
#
# `snapshot` needs a debuggable build launched after `point`, so it loaded its
# embedded bundle and is retrying the private port for an inspector.
#
# `laps` scrolls one card further and opens it each lap, and visits all five tabs.
# `browse` scrolls the feed further each round, opens a card and switches tabs
# without waiting, then times the feed return from the last flow's commands.
# The app must already be in demo mode on the feed: run enter-demo.yaml first.
set -eu

if [ -z "${VELOQ_DEVICE_LOCK_HELD:-}" ]; then
  exec "$(dirname "$0")/with-device-lock.sh" "$0" "$@"
fi

HERE=$(cd "$(dirname "$0")" && pwd)
FLOWS=$HERE/session-memory
MODE=$1
APP=$2

# One row per reading: PSS in KB for the categories that moved in earlier
# sessions, then the app summary.
header() {
  printf 'label\tseconds\tnative_heap\tdalvik_heap\tdalvik_other\tegl_mtrack\tgl_mtrack\tother_dev\tother_mmap\tunknown\tjava_heap_s\tnative_heap_s\tgraphics_s\tprivate_other_s\tsystem_s\ttotal_pss\tviews\twebviews\n'
}

reading() {
  local label=$1 seconds=$2 raw=$3
  adb shell dumpsys meminfo "$APP" >"$raw"
  awk -v label="$label" -v seconds="$seconds" '
    function first(line,   n, f) { n = split(line, f, /[ \t]+/); for (i = 1; i <= n; i++) if (f[i] ~ /^[0-9]+$/) return f[i]; return "" }
    /^ +Native Heap +[0-9]/ { nh = first($0) }
    /^ +Dalvik Heap +[0-9]/ { dh = first($0) }
    /^ +Dalvik Other +[0-9]/ { dothr = first($0) }
    /^ +EGL mtrack +[0-9]/ { egl = first($0) }
    /^ +GL mtrack +[0-9]/ { gl = first($0) }
    /^ +Other dev +[0-9]/ { odev = first($0) }
    /^ +Other mmap +[0-9]/ { omm = first($0) }
    /^ +Unknown +[0-9]/ { unk = first($0) }
    /^ +Java Heap:/ { jhs = first($0) }
    /^ +Native Heap:/ { nhs = first($0) }
    /^ +Graphics:/ { gs = first($0) }
    /^ +Private Other:/ { pos = first($0) }
    /^ +System:/ { ss = first($0) }
    /^ +TOTAL PSS:/ { tp = first($0) }
    /^ +Views:/ { views = first($0) }
    /WebViews:/ { n = split($0, f, /[ \t]+/); web = f[n] }
    END { printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n", label, seconds, nh, dh, dothr, egl, gl, odev, omm, unk, jhs, nhs, gs, pos, ss, tp, views, web }
  ' "$raw"
}

flow() {
  "$HERE/with-maestro.sh" test -e APP_ID="$APP" "$@" >/dev/null
}

# The duration of the wait for the first feed card, from Maestro's own record
# of the run it just made.
feed_return_ms() {
  local run
  run=$(ls -td "$HOME"/.maestro/tests/*/ | head -1)
  node -e '
    const fs = require("fs"), path = require("path");
    const dir = process.argv[1];
    const file = fs.readdirSync(dir).find((f) => f.startsWith("commands-") && f.endsWith(".json"));
    const cmds = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    const waits = cmds.filter((c) => c.command && c.command.assertConditionCommand);
    const last = waits[waits.length - 1];
    console.log(last && last.metadata ? last.metadata.duration : "");
  ' "$run"
}

case "$MODE" in
laps)
  LAPS=$3
  OUT=$4
  mkdir -p "$OUT"
  start=$(date +%s)
  header >"$OUT/laps.tsv"
  reading "lap0" 0 "$OUT/lap0.txt" >>"$OUT/laps.tsv"
  for lap in $(seq 1 "$LAPS"); do
    flow -e CARD=0 -e SCROLLS=$((lap > 1 ? 1 : 0)) "$FLOWS/lap.yaml"
    sleep 5
    reading "lap$lap" $(($(date +%s) - start)) "$OUT/lap$lap.txt" >>"$OUT/laps.tsv"
  done
  cat "$OUT/laps.tsv"
  ;;
browse)
  MINUTES=$3
  EVERY=$4
  OUT=$5
  mkdir -p "$OUT"
  start=$(date +%s)
  end=$((start + MINUTES * 60))
  next=$((start + EVERY * 60))
  round=0
  header >"$OUT/browse.tsv"
  printf 'seconds\tfeed_return_ms\n' >"$OUT/feed-return.tsv"
  reading "t0" 0 "$OUT/t0.txt" >>"$OUT/browse.tsv"
  while [ "$(date +%s)" -lt "$end" ]; do
    round=$((round + 1))
    # A round that loses its card is recorded and the browse goes on, since
    # what is being measured is the session and not any one round.
    if flow -e CARD=0 -e SCROLLS=$((round % 4)) "$FLOWS/browse.yaml"; then
      printf '%s\t%s\n' $(($(date +%s) - start)) "$(feed_return_ms)" >>"$OUT/feed-return.tsv"
    else
      printf '%s\tfailed\n' $(($(date +%s) - start)) >>"$OUT/feed-return.tsv"
      "$HERE/with-maestro.sh" test -e APP_ID="$APP" "$FLOWS/feed-return.yaml" >/dev/null || true
    fi
    if [ "$(date +%s)" -ge "$next" ]; then
      reading "round$round" $(($(date +%s) - start)) "$OUT/round$round.txt" >>"$OUT/browse.tsv"
      next=$((next + EVERY * 60))
    fi
  done
  sleep 5
  reading "end" $(($(date +%s) - start)) "$OUT/end.txt" >>"$OUT/browse.tsv"
  flow "$FLOWS/feed-return.yaml"
  printf 'settled\t%s\n' "$(feed_return_ms)" >>"$OUT/feed-return.tsv"
  cat "$OUT/browse.tsv" "$OUT/feed-return.tsv"
  ;;
point)
  # Point a debug build's packager at a private port, so the snapshot endpoint
  # never meets another session's Metro on the default one. Takes effect at the
  # next launch, and `unpoint` puts it back.
  PORT=$3
  adb shell am force-stop "$APP"
  printf '<?xml version="1.0" encoding="utf-8" standalone="yes" ?>\n<map>\n    <string name="debug_http_host">localhost:%s</string>\n</map>\n' "$PORT" |
    adb shell run-as "$APP" sh -c "'cat > shared_prefs/${APP}_preferences.xml'"
  adb reverse "tcp:$PORT" "tcp:$PORT"
  ;;
unpoint)
  PORT=$3
  adb shell run-as "$APP" rm -f "shared_prefs/${APP}_preferences.xml"
  adb reverse --remove "tcp:$PORT" || true
  ;;
snapshot)
  PORT=$3
  OUT=$4
  reading "$(basename "$OUT")" 0 "$OUT.meminfo.txt"
  node "$FLOWS/heap-snapshot.mjs" "$PORT" "$OUT"
  ;;
*)
  echo "measure-session-memory: unknown mode $MODE, expected laps, browse, point, unpoint or snapshot" >&2
  exit 2
  ;;
esac
