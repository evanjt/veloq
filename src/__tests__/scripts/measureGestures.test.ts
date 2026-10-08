/**
 * Scenario: the gesture rig swipes the feed back down and then opens the first
 * card. On the handset the list keeps moving for a few seconds after a swipe,
 * a tap while it moves only stops it, and the detail mounts a moment after the
 * press.
 *
 * Expected behaviour: the tap waits for the list to stop and lands on the card,
 * so every activity open is counted, and a Back is sent only from the detail,
 * never from the feed where it would leave the app.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const projectRoot = path.join(__dirname, '../../..');
const script = path.join(projectRoot, 'scripts/measure-gestures.sh');

/** Milliseconds the list keeps moving after a swipe. */
const SETTLE_MS = 5000;

/**
 * A handset on a virtual clock: `sleep` and every dump advance it, and the
 * screen, the card's bounds and whether a tap opens the card follow from it.
 */
function fakeHandset(opensOnTap: boolean) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-gestures-'));
  const bin = path.join(root, 'bin');
  const s = path.join(root, 'state');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(s, 'sdcard'), { recursive: true });
  fs.writeFileSync(path.join(s, 'clock'), '0\n');
  fs.writeFileSync(path.join(s, 'screen'), 'gone\n');
  fs.writeFileSync(path.join(s, 'swiped'), '-100000\n');

  const lib = `S=${s}
now() { cat $S/clock; }
tick() { echo $(( $(now) + $(awk -v s="$1" 'BEGIN { printf "%d", s * 1000 }') )) > $S/clock; }
get() { cat $S/$1; }
put() { echo "$2" > $S/$1; }
screen() {
  if [ "$(get screen)" = opening ] && [ "$(now)" -ge "$(get detail_at)" ]; then put screen detail; fi
  get screen
}
offset() { # the card's travel left, while the list still moves
  left=$(( ${SETTLE_MS} - ($(now) - $(get swiped)) ))
  [ "$left" -gt 0 ] && echo $(( left / 10 )) || echo 0
}`;
  const write = (name: string, body: string) =>
    fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n. ${bin}/lib\n${body}\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'lib'), lib);

  write(
    'adb',
    `[ "$1" = -s ] && shift 2
[ "$1" = shell ] && shift
exec sh -c "$(printf '%s' "$*" | sed "s#/sdcard#$S/sdcard#g")"`
  );
  write('sleep', 'tick "$1"');
  write('pidof', 'echo 1234');
  write('top', 'echo "1234 u0_a1 10 -10 1G 1M 1M S 1.0 1.0 0:01 veloq"');
  write('wm', 'echo "Physical size: 1080x2340"');
  write(
    'am',
    `case "$1" in
  force-stop) put screen gone ;;
  start) echo start >> $S/starts; put screen home; put swiped -100000 ;;
esac`
  );
  write(
    'dumpsys',
    `case "$1" in
  window) [ "$(screen)" != gone ] && echo "mCurrentFocus=Window{1 u0 com.veloq.app.dev/com.veloq.app.dev.MainActivity}" ;;
  package) echo "lastUpdateTime=2026-01-01" ;;
  gfxinfo) echo "Total frames rendered: 10" ;;
esac
exit 0`
  );
  write(
    'uiautomator',
    `tick 1
case "$(screen)" in
  home)
    y=$(( 400 + $(offset) ))
    {
      echo '<node resource-id="home-screen" bounds="[0,0][1080,2340]">'
      echo "<node resource-id=\\"activity-card-a1\\" bounds=\\"[0,$y][1080,$(( y + 600 ))]\\">"
      echo "<node resource-id=\\"activity-card-bottom-a1\\" bounds=\\"[0,$(( y + 500 ))][1080,$(( y + 600 ))]\\" />"
      echo '<node content-desc="Feed" bounds="[0,2200][200,2340]" />'
      echo '<node content-desc="Map" bounds="[300,2200][500,2340]" />'
    } > "$2" ;;
  map) echo '<node resource-id="map-screen" bounds="[0,0][1080,2340]"><node content-desc="Feed" bounds="[0,2200][200,2340]" />' > "$2" ;;
  detail) echo '<node resource-id="activity-detail-screen" bounds="[0,0][1080,2340]">' > "$2" ;;
  *) echo '<node bounds="[0,0][1080,2340]">' > "$2" ;;
esac
echo "UI hierchary dumped to: $2"`
  );
  write(
    'input',
    `case "$1" in
  swipe) [ "$(screen)" = home ] && put swiped "$(now)"; tick 0.4 ;;
  keyevent)
    case "$(screen)" in
      detail|opening) put screen home ;;
      home) echo back >> $S/feed-backs; put screen gone ;;
    esac ;;
  tap)
    x=$2 y=$3
    case "$(screen)" in
      home)
        if [ "$y" -ge 2200 ]; then
          [ "$x" -ge 300 ] && put screen map
        else
          top=$(( 400 + $(offset) ))
          moving=$(( $(now) - $(get swiped) < ${SETTLE_MS} ))
          if [ ${opensOnTap ? 1 : 0} = 1 ] && [ "$moving" = 0 ] && [ "$y" -ge "$top" ] && [ "$y" -le $(( top + 600 )) ]; then
            put screen opening; put detail_at $(( $(now) + 1000 ))
          fi
        fi ;;
      map) [ "$y" -ge 2200 ] && [ "$x" -lt 200 ] && put screen home ;;
    esac ;;
esac
exit 0`
  );

  const out = path.join(root, 'out');
  const run = () =>
    spawnSync(script, [out, '2'], {
      encoding: 'utf8',
      timeout: 60000,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        ANDROID_SERIAL: 'fake-serial',
        VELOQ_DEVICE_LOCK_HELD: '1',
        SETTLE: '0',
      },
    });
  const lines = (name: string) =>
    fs.existsSync(path.join(s, name))
      ? fs.readFileSync(path.join(s, name), 'utf8').trim().split('\n')
      : [];
  return { out, run, lines };
}

describe('measure-gestures.sh activity open', () => {
  it('opens the card once the list has stopped, in every run, without leaving the app', () => {
    const { out, run, lines } = fakeHandset(true);
    const result = run();

    const files = fs.readdirSync(out);
    expect(files.filter((f) => f.startsWith('activity-open-')).sort()).toEqual([
      'activity-open-0.txt',
      'activity-open-1.txt',
      'activity-open-2.txt',
    ]);
    expect(files.filter((f) => f.endsWith('.bad'))).toEqual([]);
    expect(result.stderr).not.toContain('not back on the feed');
    expect(lines('starts')).toHaveLength(1);
    expect(lines('feed-backs')).toEqual([]);
  });

  it('marks an open that never shows the detail bad and sends no Back from the feed', () => {
    const { out, run, lines } = fakeHandset(false);
    run();

    const files = fs.readdirSync(out);
    expect(files.filter((f) => f.startsWith('activity-open-')).sort()).toEqual([
      'activity-open-0.bad',
      'activity-open-1.bad',
      'activity-open-2.bad',
    ]);
    expect(lines('feed-backs')).toEqual([]);
    expect(lines('starts')).toHaveLength(1);
  });
});
