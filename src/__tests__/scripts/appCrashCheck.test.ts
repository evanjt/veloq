/**
 * Scenario: a flow suite retries every failed flow, so a crash of the app that
 * happens on one launch passes on the retry and the job reports green.
 *
 * Expected behaviour: the check reads the whole logcat and the simulator's crash
 * reports after the flows, fails on a fatal exception, a native fatal signal or a
 * Rust panic from the app's own process, and ignores the same events from any
 * other package.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/check-app-crashes.mjs');

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'app-crashes-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run(args: string[]): { code: number; out: string } {
  try {
    const out = execFileSync('node', [SCRIPT, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GITHUB_STEP_SUMMARY: '' },
    });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string };
    return { code: err.status, out: err.stdout + err.stderr };
  }
}

function logcat(lines: string[]): string {
  const file = join(dir, 'logcat.txt');
  writeFileSync(file, lines.join('\n') + '\n');
  return file;
}

const QUIET =
  '10-31 09:00:00.100  900  900 I ActivityManager: Displayed com.veloq.app.dev/.MainActivity';
const OWN_FATAL = [
  '10-31 09:01:00.000  4242  4242 E AndroidRuntime: FATAL EXCEPTION: main',
  '10-31 09:01:00.000  4242  4242 E AndroidRuntime: Process: com.veloq.app.dev, PID: 4242',
  '10-31 09:01:00.000  4242  4242 E AndroidRuntime: java.lang.IllegalStateException: boom',
];
const OTHER_FATAL = [
  '10-31 09:02:00.000  5151  5151 E AndroidRuntime: FATAL EXCEPTION: main',
  '10-31 09:02:00.000  5151  5151 E AndroidRuntime: Process: com.example.other, PID: 5151',
  '10-31 09:02:00.000  5151  5151 E AndroidRuntime: java.lang.RuntimeException: not ours',
];

describe('android logcat', () => {
  it('fails on a fatal exception from the app and prints it', () => {
    const r = run(['--logcat', logcat([QUIET, ...OWN_FATAL])]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('FATAL EXCEPTION');
    expect(r.out).toContain('IllegalStateException');
  });

  it('ignores a fatal exception from another package', () => {
    const r = run(['--logcat', logcat([QUIET, ...OTHER_FATAL])]);
    expect(r.code).toBe(0);
  });

  it('fails on ours when both packages crashed, naming only ours', () => {
    const r = run(['--logcat', logcat([...OTHER_FATAL, ...OWN_FATAL])]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('com.veloq.app.dev');
    expect(r.out).not.toContain('not ours');
  });

  it('reads the time format as well as threadtime', () => {
    const r = run([
      '--logcat',
      logcat([
        'E/AndroidRuntime( 4242): FATAL EXCEPTION: main',
        'E/AndroidRuntime( 4242): Process: com.veloq.app.dev, PID: 4242',
      ]),
    ]);
    expect(r.code).toBe(1);
  });

  it('fails on a native fatal signal in the app process only', () => {
    const own =
      '10-31 09:03:00.000  6000  6010 F libc    : Fatal signal 11 (SIGSEGV), code 1 (SEGV_MAPERR), fault addr 0x0 in tid 6010 (mqt_v_js), pid 6000 (com.veloq.app.dev)';
    const other =
      '10-31 09:03:00.000  6100  6110 F libc    : Fatal signal 6 (SIGABRT), code -1 (SI_QUEUE) in tid 6110 (x), pid 6100 (com.example.other)';
    expect(run(['--logcat', logcat([QUIET, own])]).code).toBe(1);
    expect(run(['--logcat', logcat([QUIET, other])]).code).toBe(0);
  });

  it('fails on a Rust panic whose pid was started as the app, not on another pid', () => {
    const start =
      '10-31 09:00:01.000   900  900 I ActivityManager: Start proc 7000:com.veloq.app.dev/u0a190 for top-activity {com.veloq.app.dev/com.veloq.app.MainActivity}';
    const panic = (pid: number) =>
      `10-31 09:04:00.000  ${pid}  ${pid} E RustStdoutStderr: thread 'veloq-worker' panicked at src/lib.rs:10:5:`;
    expect(run(['--logcat', logcat([start, panic(7000)])]).code).toBe(1);
    expect(run(['--logcat', logcat([start, panic(7001)])]).code).toBe(0);
  });

  it('accepts a log with no crash', () => {
    expect(run(['--logcat', logcat([QUIET])]).code).toBe(0);
  });

  it('refuses a missing or empty log, which would let a blind check pass', () => {
    expect(run(['--logcat', join(dir, 'absent.txt')]).code).toBe(2);
    const empty = join(dir, 'empty.txt');
    writeFileSync(empty, '');
    expect(run(['--logcat', empty]).code).toBe(2);
  });
});

describe('ios crash reports', () => {
  function reports(names: string[]): string {
    const d = join(dir, 'reports');
    mkdirSync(d);
    for (const n of names) writeFileSync(join(d, n), '{}');
    return d;
  }

  it('fails on a report for the app', () => {
    const r = run(['--ios-reports', reports(['VeloqDev-2026-10-31-090000.ips'])]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('VeloqDev-2026-10-31-090000.ips');
  });

  it('ignores a report for another app', () => {
    expect(run(['--ios-reports', reports(['OtherApp-2026-10-31-090000.ips'])]).code).toBe(0);
  });

  it('accepts a missing directory as no reports', () => {
    expect(run(['--ios-reports', join(dir, 'none')]).code).toBe(0);
  });
});
