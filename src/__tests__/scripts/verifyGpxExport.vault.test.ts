/**
 * `verify-gpx-export.sh` run against a fake `adb` whose `run-as` reads a
 * directory standing in for the app's data, so nothing reaches a phone.
 *
 * Expected behaviour: the script validates the newest GPX in `cache/exports/`,
 * where the app writes every file it hands to the share sheet, still reads one
 * left in `cache/` by an older build, and fails naming both paths when neither
 * holds one.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const SCRIPT = path.resolve(__dirname, '../../../scripts/verify-gpx-export.sh');

/** A GPX track of `points` points inside the fixture's Alpine bounds. */
function gpx(points: number): string {
  const trkpts = Array.from(
    { length: points },
    (_, i) =>
      `<trkpt lat="${(46.5 + i * 0.001).toFixed(4)}" lon="${(7.5 + i * 0.001).toFixed(4)}"><ele>1200</ele></trkpt>`
  ).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1"><trk><trkseg>\n${trkpts}\n</trkseg></trk></gpx>\n`;
}

/** A fake app data directory holding `files`, and an `adb` that serves it. */
function device(files: Record<string, string>): { dir: string; bin: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-gpx-'));
  const data = path.join(dir, 'data');
  fs.mkdirSync(path.join(data, 'cache'), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(data, name)), { recursive: true });
    fs.writeFileSync(path.join(data, name), body);
  }
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(
    path.join(bin, 'adb'),
    `#!/usr/bin/env bash
[ "$1" = shell ] || exit 0
cmd="$2"
cmd="\${cmd#run-as com.veloq.app.dev }"
cd "${data}" && eval "$cmd"
`,
    { mode: 0o755 }
  );
  return { dir, bin };
}

function verify(files: Record<string, string>) {
  const { dir, bin } = device(files);
  try {
    const run = spawnSync(SCRIPT, [], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, VELOQ_DEVICE_LOCK_HELD: '1' },
    });
    return { status: run.status, out: `${run.stdout}${run.stderr}` };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('verify-gpx-export.sh', () => {
  it('validates the GPX the export writes into cache/exports/', () => {
    const run = verify({ 'cache/exports/Morning_Alpine_Ride.gpx': gpx(40) });
    expect(run.out).toContain('Found: cache/exports/Morning_Alpine_Ride.gpx');
    expect(run.out).toContain('PASS: 40 trackpoints');
    expect(run.status).toBe(0);
  });

  it('reads cache/exports/ before a GPX an older build left in cache/', () => {
    const run = verify({
      'cache/Old_Ride.gpx': gpx(12),
      'cache/exports/Morning_Alpine_Ride.gpx': gpx(40),
    });
    expect(run.out).toContain('Found: cache/exports/Morning_Alpine_Ride.gpx');
    expect(run.out).toContain('PASS: 40 trackpoints');
    expect(run.status).toBe(0);
  });

  it('still validates a GPX an older build wrote straight into cache/', () => {
    const run = verify({ 'cache/Old_Ride.gpx': gpx(12) });
    expect(run.out).toContain('Found: cache/Old_Ride.gpx');
    expect(run.out).toContain('PASS: 12 trackpoints');
    expect(run.status).toBe(0);
  });

  it('fails naming both paths when neither holds a GPX', () => {
    const run = verify({ 'cache/exports/veloq-crash-log.txt': 'log\n' });
    expect(run.status).toBe(1);
    expect(run.out).toContain('cache/exports/');
    expect(run.out).toMatch(/cache\/ /);
    expect(run.out).not.toContain('PASS');
  });

  it('fails a GPX in cache/exports/ that holds too few trackpoints', () => {
    const run = verify({ 'cache/exports/Short.gpx': gpx(3) + ' '.repeat(600) });
    expect(run.status).toBe(1);
    expect(run.out).toContain('FAIL: only 3 trkpt entries');
  });
});
