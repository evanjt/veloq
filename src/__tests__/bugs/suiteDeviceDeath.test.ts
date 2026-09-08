/**
 * Scenario: the Maestro device server dies mid-suite under software GL. The
 * flow it dies on fails, and every flow queued behind it reports `Unknown
 * error` in milliseconds. The retry pass reruns them on the same poisoned
 * emulator, so the gate reports a dozen map bugs that never happened.
 *
 * Expected behaviour: `run-suite.sh` tells a dead device from a failed step.
 * It restarts the device once, reruns only the flows that died, and lets a
 * flow that failed on a step fail the gate the way it always did.
 */

import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const SCRIPT = path.resolve(__dirname, '../../../.maestro/run-suite.sh');

type Case = { name: string; time: string; failure?: string };

function junit(cases: Case[]): string {
  const body = cases
    .map((c) =>
      c.failure
        ? `<testcase name="${c.name}" time="${c.time}"><failure>${c.failure}</failure></testcase>`
        : `<testcase name="${c.name}" time="${c.time}"/>`
    )
    .join('\n');
  return `<?xml version="1.0"?>\n<testsuite>\n${body}\n</testsuite>\n`;
}

/**
 * A stand-in for the maestro binary. The suite pass writes `report` and fails.
 * Each single-flow rerun writes a passing report unless its name is in
 * `failAgain`, and every invocation appends its arguments to a log.
 */
function fakeMaestro(dir: string, report: string, failAgain: Record<string, string>): string {
  const bin = path.join(dir, 'maestro');
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env bash
out=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "--output" ]; then out="$arg"; fi
  prev="$arg"
done
echo "$*" >> "${dir}/calls.log"
if [ "$2" = ".maestro/" ]; then
  cat "${dir}/suite-report.xml" > "$out"
  exit 1
fi
flow=$(basename "$2" .yaml)
again=$(grep -F "\${flow}=" "${dir}/fail-again" | head -1 | cut -d= -f2-)
if [ -n "$again" ]; then
  printf '<testsuite><testcase name="%s" time="0.04"><failure>%s</failure></testcase></testsuite>' "$flow" "$again" > "$out"
  exit 1
fi
printf '<testsuite><testcase name="%s" time="70"/></testsuite>' "$flow" > "$out"
exit 0
`,
    { mode: 0o755 }
  );
  fs.writeFileSync(path.join(dir, 'suite-report.xml'), report);
  fs.writeFileSync(
    path.join(dir, 'fail-again'),
    Object.entries(failAgain)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n') + '\n'
  );
  return bin;
}

function run(cases: Case[], failAgain: Record<string, string> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-suite-'));
  const bin = fakeMaestro(dir, junit(cases), failAgain);
  const cwd = path.resolve(__dirname, '../../..');
  let status = 0;
  let stdout = '';
  try {
    stdout = execFileSync(
      'bash',
      [SCRIPT, path.join(dir, 'out.xml'), path.join(dir, 'debug'), '--include-tags=pack-map'],
      {
        cwd,
        encoding: 'utf8',
        env: {
          ...process.env,
          MAESTRO_BIN: bin,
          MAESTRO_RESTART_CMD: `echo restarted >> ${dir}/restarts.log`,
        },
      }
    );
  } catch (e) {
    const err = e as { status: number; stdout: string };
    status = err.status;
    stdout = err.stdout;
  }
  const read = (f: string) =>
    fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), 'utf8') : '';
  return {
    status,
    stdout,
    calls: read('calls.log').trim().split('\n').filter(Boolean),
    restarts: read('restarts.log').trim().split('\n').filter(Boolean).length,
  };
}

const DIED =
  'maestro.android.DeviceServerDiedException: Device server died during viewHierarchy on emulator-5554';

describe('a suite that lost the device', () => {
  it('restarts once and reruns the flows that died', () => {
    const result = run([
      { name: 'map-visual-validation', time: '43.2', failure: DIED },
      { name: 'activity-map-long-press-highlight', time: '0.039', failure: 'Unknown error' },
      { name: 'map-style-switching', time: '1.4', failure: 'Unknown error' },
    ]);

    expect(result.restarts).toBe(1);
    expect(result.calls.filter((c) => c.includes('map-visual-validation.yaml'))).toHaveLength(1);
    expect(result.calls.filter((c) => c.includes('map-style-switching.yaml'))).toHaveLength(1);
    expect(result.status).toBe(0);
  });

  it('does not restart when every failure is a real assertion', () => {
    const result = run(
      [{ name: 'map-style-switching', time: '38.1', failure: 'Assertion is false: id: map-view' }],
      { 'map-style-switching': 'Assertion is false: id: map-view' }
    );

    expect(result.restarts).toBe(0);
    expect(result.status).toBe(1);
  });

  it('still fails when a flow dies again after the restart', () => {
    const result = run([{ name: 'map-visual-validation', time: '43.2', failure: DIED }], {
      'map-visual-validation': DIED,
    });

    expect(result.restarts).toBe(1);
    expect(result.status).toBe(1);
  });

  it('restarts once, not once per dead flow', () => {
    const result = run([
      { name: 'map-visual-validation', time: '43.2', failure: DIED },
      { name: 'map-style-switching', time: '12.0', failure: DIED },
      { name: 'regional-map-toggles', time: '0.014', failure: 'Unknown error' },
    ]);

    expect(result.restarts).toBe(1);
  });

  it('keeps a slow Unknown error as a real failure, it is not the device', () => {
    const result = run([{ name: 'map-style-switching', time: '61.0', failure: 'Unknown error' }], {
      'map-style-switching': 'Unknown error',
    });

    expect(result.restarts).toBe(0);
    expect(result.status).toBe(1);
  });
});
