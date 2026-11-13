/**
 * Scenario: a staged first visit no longer has a frame over 50 ms, and most of
 * the frames after the tap are render-thread animation frames (`Flags=2`), so a
 * mount read as the first long frame comes back as NaN.
 *
 * Expected behaviour: given the screen's own `tab.*` figure beside the capture
 * (`RUN.txt=MS`), the mount is the first UI-thread frame whose vsync falls
 * after the tap plus that figure, whatever it took. With no figure the mount is
 * unknown, never a guess.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const SCRIPT = path.resolve(__dirname, '../../../scripts/lib/tab-visit-framestats.mjs');

const MS = 1e6;
const VSYNC = 8_333_333;
const T0 = 5_000_000 * MS;

interface Frame {
  flags: number;
  vsyncAt: number;
  tookMs: number;
  input?: number;
}

function dump(frames: Frame[]): string {
  const header = 'Flags,IntendedVsync,Vsync,InputEventId,HandleInputStart,FrameCompleted,';
  const rows = frames.map((f) => {
    const vsync = T0 + f.vsyncAt;
    return [
      f.flags,
      vsync,
      vsync,
      f.input ?? 0,
      vsync + 1 * MS,
      vsync + Math.round(f.tookMs * MS),
      '',
    ].join(',');
  });
  return [
    'Applications Graphics Acceleration Info:',
    'com.example.dev/com.example.dev.MainActivity/android.view.ViewRootImpl@1a2b3c (visibility=0)',
    '---PROFILEDATA---',
    header,
    ...rows,
    '---PROFILEDATA---',
  ].join('\n');
}

// A press and its release, then two hundred milliseconds of frames: render
// thread animation every vsync, and UI-thread frames that are all under 50 ms.
// The release frame's input starts at 1 ms after its vsync, which is the tap.
const PRESS_AT = 0;
const RELEASE_AT = 6 * VSYNC;
const TAP = RELEASE_AT + 1 * MS;
const FADE_AT = 8 * VSYNC;
const EARLY_UI_AT = 14 * VSYNC;
const MOUNT_AT = 17 * VSYNC;
const MOUNT_TOOK_MS = 34;

function firstVisit(): Frame[] {
  const frames: Frame[] = [
    { flags: 0, vsyncAt: PRESS_AT, tookMs: 7, input: 41 },
    { flags: 0, vsyncAt: RELEASE_AT, tookMs: 9, input: 42 },
  ];
  for (let n = 7; n < 32; n += 1) {
    const at = n * VSYNC;
    if (at === FADE_AT) frames.push({ flags: 0, vsyncAt: at, tookMs: 21 });
    else if (at === EARLY_UI_AT) frames.push({ flags: 0, vsyncAt: at, tookMs: 12 });
    else if (at === MOUNT_AT) frames.push({ flags: 0, vsyncAt: at, tookMs: MOUNT_TOOK_MS });
    else frames.push({ flags: 2, vsyncAt: at, tookMs: 6 });
  }
  return frames;
}

function run(files: Record<string, string>, args: string[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tab-visit-framestats-'));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  const res = spawnSync('node', [SCRIPT, ...args], { cwd: dir, encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  if (res.status !== 0) throw new Error(res.stderr);
  return res.stdout;
}

function firstOf(stdout: string, file: string): number {
  const line = stdout.split('\n').find((l) => l.startsWith(`${file} `));
  if (!line) throw new Error(`no line for ${file} in:\n${stdout}`);
  const match = line.match(/\bfirst=(\S+)/);
  return match ? Number(match[1]) : NaN;
}

describe('tab-visit-framestats finds the mount frame', () => {
  const expected = (MOUNT_AT + MOUNT_TOOK_MS * MS - TAP) / MS;

  it('takes the first UI-thread frame after the tap plus the screen metric, with every frame under 50 ms', () => {
    // 82 ms after the tap falls between the early UI-thread frame and the mount.
    const out = run({ 'run.txt': dump(firstVisit()) }, ['run.txt=82']);
    const first = firstOf(out, 'run.txt');
    expect(Number.isFinite(first)).toBe(true);
    expect(first).toBeCloseTo(expected, 0);
  });

  it('takes a frame whose vsync lands exactly on the tap plus the metric', () => {
    const metric = (MOUNT_AT - TAP) / MS;
    const out = run({ 'run.txt': dump(firstVisit()) }, [`run.txt=${metric}`]);
    expect(firstOf(out, 'run.txt')).toBeCloseTo(expected, 0);
  });

  it('skips render-thread frames that fall after the metric', () => {
    // The vsync after the early UI-thread frame is a Flags=2 frame; the mount
    // is the UI-thread frame two vsyncs later.
    const metric = (EARLY_UI_AT - TAP) / MS + 1;
    const out = run({ 'run.txt': dump(firstVisit()) }, [`run.txt=${metric}`]);
    expect(firstOf(out, 'run.txt')).toBeCloseTo(expected, 0);
  });

  it('reports no mount when no UI-thread frame follows the metric', () => {
    const out = run({ 'run.txt': dump(firstVisit()) }, ['run.txt=400']);
    expect(firstOf(out, 'run.txt')).toBeNaN();
  });

  it('reports no mount when the capture has no metric beside it', () => {
    const out = run({ 'run.txt': dump(firstVisit()) }, ['run.txt']);
    expect(firstOf(out, 'run.txt')).toBeNaN();
  });

  it('summarises the mount over several runs, each with its own metric', () => {
    const out = run({ 'a.txt': dump(firstVisit()), 'b.txt': dump(firstVisit()) }, [
      'a.txt=82',
      'b.txt=82',
    ]);
    const summary = out.split('\n').find((l) => l.startsWith('first '));
    expect(summary).toMatch(/n=2\b/);
    expect(Number(summary?.match(/median=(\S+)/)?.[1])).toBeCloseTo(expected, 0);
  });
});
