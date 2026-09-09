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
function fakeMaestro(
  dir: string,
  report: string,
  failAgain: Record<string, string>,
  killsDevice: string[]
): string {
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
# A --device flag shifts the positional arguments, so the target is found
# by scanning rather than by position.
target=""
for arg in "$@"; do
  case "$arg" in
    .maestro/|*.yaml) target="$arg" ;;
  esac
done
if [ "$target" = ".maestro/" ]; then
  cat "${dir}/suite-report.xml" > "$out"
  exit 1
fi
flow=$(basename "$target" .yaml)
if [ ! -f "${dir}/alive" ]; then
  printf '<testsuite><testcase name="%s" time="0.03"><failure>Unknown error</failure></testcase></testsuite>' "$flow" > "$out"
  exit 1
fi
# The flow runs and passes, and the device goes down behind it.
if grep -qxF "\${flow}" "${dir}/kills-device"; then rm -f "${dir}/alive"; fi
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
  fs.writeFileSync(path.join(dir, 'kills-device'), killsDevice.join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'alive'), '');
  return bin;
}

function run(
  cases: Case[],
  failAgain: Record<string, string> = {},
  killsDevice: string[] = [],
  device?: string
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-suite-'));
  const bin = fakeMaestro(dir, junit(cases), failAgain, killsDevice);
  // The script writes `retry-reports/` beside the working directory, so it runs
  // in the temp directory with the real flow files linked in rather than
  // littering the checkout.
  const cwd = dir;
  fs.symlinkSync(path.resolve(__dirname, '../../../.maestro'), path.join(dir, '.maestro'));
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
          // A restart revives the device, which is what makes a second one useful.
          MAESTRO_RESTART_CMD: `echo restarted >> ${dir}/restarts.log; touch ${dir}/alive`,
          MAESTRO_HEALTH_CMD: `test -f ${dir}/alive`,
          ...(device ? { MAESTRO_DEVICE: device } : {}),
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

/**
 * Scenario: the device dies again *inside* the retry pass, which is what run
 * 34360266980 did. `auth-api-key-validation` was retried and passed, the device
 * went with it, and the four flows behind it were retried against nothing.
 *
 * Expected behaviour: the pass checks the device before each flow rather than
 * trusting the one restart it did at the start. A flow that never saw a live
 * device has not been tested, so failing the gate on it reports a bug that was
 * never observed.
 */
describe('a device that dies inside the retry pass', () => {
  it('restarts before the flow behind it, and that flow passes', () => {
    const result = run(
      [
        { name: 'auth-api-key-validation', time: '3.8', failure: 'Unknown error' },
        { name: 'settings-support-iap', time: '0.035', failure: 'Unknown error' },
      ],
      {},
      ['auth-api-key-validation']
    );

    expect(result.calls.filter((c) => c.includes('settings-support-iap.yaml'))).toHaveLength(1);
    expect(result.restarts).toBe(2);
    expect(result.status).toBe(0);
  });

  it('does not probe its way into a restart when the device is healthy', () => {
    const result = run([{ name: 'smoke', time: '0.03', failure: 'Unknown error' }]);

    expect(result.restarts).toBe(1);
    expect(result.status).toBe(0);
  });
});

/**
 * Scenario: the suite is run on a workstation with more than one device
 * attached. `maestro test .maestro/` is given no device, so Maestro picks one
 * itself and shards the flows across everything it can see.
 *
 * Expected behaviour: naming a device pins every invocation to it, the suite
 * pass and each retry alike. On 2026-09-09 an unpinned local run put
 * `section-history` and `settings-support-iap` on a phone that was not the
 * intended target, which the suite's own log records as
 * `[shard 1] Selected device 10.0.0.3:5555`. CI attaches one device so it
 * never saw this, and the gate is not where the cost lands.
 */
describe('a suite told which device to use', () => {
  it('pins the suite pass and every retry to it', () => {
    const result = run(
      [{ name: 'smoke', time: '0.03', failure: 'Unknown error' }],
      {},
      [],
      'emulator-5554'
    );

    expect(result.calls).not.toHaveLength(0);
    for (const call of result.calls) {
      expect(call).toContain('--device emulator-5554');
    }
  });

  it('leaves the invocation alone when no device is named', () => {
    const result = run([{ name: 'smoke', time: '0.03', failure: 'Unknown error' }]);

    for (const call of result.calls) {
      expect(call).not.toContain('--device');
    }
  });
});

/**
 * Scenario: the suite is pinned to one device and loses it, so the built-in
 * `restart_device` runs rather than an overriding `MAESTRO_RESTART_CMD`.
 *
 * Expected behaviour: it restarts that device and nothing else. `adb
 * kill-server` is server-wide and takes every other attached device's
 * connection with it, which on a workstation means dropping a phone somebody
 * is using. A named device is reachable with `-s`, so the blunt instrument is
 * only for the gate's single-device runner.
 */
describe('restarting a named device', () => {
  function runWithFakeAdb(device?: string) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-suite-adb-'));
    const bin = fakeMaestro(dir, junit([{ name: 'smoke', time: '0.03', failure: DIED }]), {}, []);
    const adb = path.join(dir, 'adb');
    fs.writeFileSync(adb, `#!/usr/bin/env bash\necho "$*" >> "${dir}/adb.log"\necho 1\n`);
    fs.chmodSync(adb, 0o755);
    fs.symlinkSync(path.resolve(__dirname, '../../../.maestro'), path.join(dir, '.maestro'));
    try {
      execFileSync('bash', [SCRIPT, path.join(dir, 'out.xml'), path.join(dir, 'debug')], {
        cwd: dir,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          MAESTRO_BIN: bin,
          ...(device ? { MAESTRO_DEVICE: device } : {}),
        },
      });
    } catch {
      // The suite fails by design; the adb log is what is under test.
    }
    const log = path.join(dir, 'adb.log');
    return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];
  }

  it('never kills the shared server, and scopes every call to that device', () => {
    const calls = runWithFakeAdb('emulator-5554');

    expect(calls).not.toHaveLength(0);
    expect(calls.some((c) => c.includes('kill-server'))).toBe(false);
    for (const call of calls) {
      expect(call).toContain('-s emulator-5554');
    }
  });

  it('keeps the blunt restart when no device is named', () => {
    const calls = runWithFakeAdb();

    expect(calls.some((c) => c.includes('kill-server'))).toBe(true);
  });
});
