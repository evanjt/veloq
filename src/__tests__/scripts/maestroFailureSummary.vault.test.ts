/**
 * Scenario: a failing Maestro job keeps its cause in an artifact that has to be
 * downloaded before anyone can read it.
 *
 * Expected behaviour: the summary script names the failed flows from the JUnit
 * report, the newest screenshot and the app's own crash lines, writes them to
 * the job summary file, and writes nothing for a passing run.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/maestro-failure-summary.mjs');

let dir: string;
let summaryFile: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maestro-summary-'));
  summaryFile = join(dir, 'summary.md');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run(args: string[]): { out: string; summary: string } {
  const out = execFileSync('node', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_STEP_SUMMARY: summaryFile },
  });
  let summary = '';
  try {
    summary = readFileSync(summaryFile, 'utf8');
  } catch {
    // nothing was written
  }
  return { out, summary };
}

const REPORT = `<testsuites><testsuite>
  <testcase name="open-the-ride-list" status="SUCCESS"/>
  <testcase name="share &amp; export" status="ERROR"><failure>element not found</failure></testcase>
  <testcase name="pick-a-range" status="SUCCESS"></testcase>
</testsuite></testsuites>`;

describe('maestro failure summary', () => {
  it('lists the failed flows, the last screenshot and the app crash lines', () => {
    const report = join(dir, 'report.xml');
    writeFileSync(report, REPORT);
    const debug = join(dir, 'debug', 'flow');
    mkdirSync(debug, { recursive: true });
    writeFileSync(join(debug, 'old.png'), '');
    writeFileSync(join(debug, 'new.png'), '');
    utimesSync(join(debug, 'old.png'), new Date(1000), new Date(1000));
    const logcat = join(dir, 'logcat.txt');
    writeFileSync(
      logcat,
      [
        '10-31 09:01:00.000  4242  4242 E AndroidRuntime: FATAL EXCEPTION: main',
        '10-31 09:01:00.000  4242  4242 E AndroidRuntime: Process: com.veloq.app, PID: 4242',
        '10-31 09:02:00.000  5151  5151 E AndroidRuntime: FATAL EXCEPTION: main',
        '10-31 09:02:00.000  5151  5151 E AndroidRuntime: Process: com.example.other, PID: 5151',
      ].join('\n') + '\n'
    );
    const { out, summary } = run([
      '--report',
      report,
      '--debug',
      join(dir, 'debug'),
      '--logcat',
      logcat,
    ]);
    expect(summary).toBe(out);
    expect(summary).toContain('- share & export');
    expect(summary).not.toContain('open-the-ride-list');
    expect(summary).not.toContain('pick-a-range');
    expect(summary).toContain(join(debug, 'new.png'));
    expect(summary).not.toContain('old.png');
    expect(summary).toContain('com.veloq.app');
    expect(summary).not.toContain('com.example.other');
  });

  it('writes nothing for a run with no failure, no screenshot and no crash', () => {
    const report = join(dir, 'report.xml');
    writeFileSync(report, '<testsuites><testcase name="a" status="SUCCESS"/></testsuites>');
    const { out, summary } = run(['--report', report, '--debug', join(dir, 'missing')]);
    expect(out).toBe('');
    expect(summary).toBe('');
  });
});
