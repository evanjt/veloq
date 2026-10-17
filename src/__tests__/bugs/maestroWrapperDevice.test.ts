/**
 * Scenario: two handsets are attached and the run is pinned to one of them
 * through `ANDROID_SERIAL`. The device lock is taken on that serial and every
 * `adb` call in the session reaches it, but Maestro is handed no device and
 * picks the first transport itself, which is the other phone.
 *
 * Expected behaviour: the wrapper resolves the serial the lock resolves and
 * passes it to Maestro as `--device`, ahead of the subcommand, and refuses
 * when several are attached and none is named.
 */

import { execFileSync, spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const SCRIPT = path.resolve(__dirname, '../../../scripts/with-maestro.sh');

const LOCKED = 'emulator-5554';
const OTHER = 'emulator-5556';

/**
 * `say` is what the fake Maestro prints before it runs the flow, and the flow
 * is a second's sleep and then a line in `ran.log`, so a run the wrapper kills
 * leaves no line there.
 */
function fakeBins(dir: string, attached: string[], say = '', exitCode = 0): void {
  const listing = ['List of devices attached', ...attached.map((s) => `${s}\tdevice`), ''].join(
    '\n'
  );
  fs.writeFileSync(
    path.join(dir, 'adb'),
    `#!/usr/bin/env bash\nif [ "$1" = "devices" ]; then\n  cat <<'EOF'\n${listing}EOF\n  exit 0\nfi\nexit 0\n`,
    { mode: 0o755 }
  );
  fs.writeFileSync(
    path.join(dir, 'maestro'),
    [
      '#!/usr/bin/env bash',
      `printf '%s\\n' "$*" >> "${dir}/calls.log"`,
      say ? `printf '%s\\n' '${say}'\nsleep 1` : '',
      `echo ran >> "${dir}/ran.log"`,
      `exit ${exitCode}`,
      '',
    ].join('\n'),
    { mode: 0o755 }
  );
}

function run(
  attached: string[],
  serial?: string,
  args: string[] = ['test', 'flow.yaml'],
  say = '',
  exitCode = 0
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'with-maestro-'));
  fakeBins(dir, attached, say, exitCode);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${dir}:${process.env.PATH}`,
    // The lock is the caller's here, as it is under `device-lock-shell.sh`,
    // so the wrapper runs its own body rather than re-execing.
    VELOQ_DEVICE_LOCK_HELD: '1',
    // The host's Maestro lock sits beside the device locks, so it is this test's own.
    VELOQ_DEVICE_LOCK_DIR: dir,
  };
  for (const name of [
    'VELOQ_MAESTRO_LOCK',
    'VELOQ_MAESTRO_LOCK_PATH',
    'VELOQ_MAESTRO_LOCK_HELD',
    'ANDROID_SERIAL',
    'VELOQ_DEVICE_SERIAL',
    'VELOQ_DEVICE_LOCK',
    'VELOQ_DEVICE_LOCK_PATH',
    'VELOQ_DEVICE_LOCK_AMBIGUOUS',
  ]) {
    delete env[name];
  }
  if (serial) env.ANDROID_SERIAL = serial;

  let status = 0;
  let stdout = '';
  let stderr = '';
  try {
    stdout = execFileSync('bash', [SCRIPT, ...args], { cwd: dir, encoding: 'utf8', env });
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string };
    status = err.status;
    stdout = err.stdout;
    stderr = err.stderr;
  }
  const log = path.join(dir, 'calls.log');
  return {
    status,
    stdout,
    stderr,
    ran: fs.existsSync(path.join(dir, 'ran.log')),
    calls: fs.existsSync(log)
      ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean)
      : [],
  };
}

describe('the Maestro wrapper and the handset it reaches', () => {
  it('pins the serial the run is locked to, ahead of the subcommand', () => {
    const result = run([OTHER, LOCKED], LOCKED);

    expect(result.status).toBe(0);
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0]).toBe(`--device ${LOCKED} test flow.yaml`);
    expect(result.calls[0]).not.toContain(OTHER);
  });

  it('pins the only handset attached when none is named', () => {
    const result = run([LOCKED]);

    expect(result.status).toBe(0);
    expect(result.calls[0]).toBe(`--device ${LOCKED} test flow.yaml`);
  });

  it('refuses rather than let Maestro choose between two', () => {
    const result = run([OTHER, LOCKED]);

    expect(result.status).not.toBe(0);
    expect(result.calls).toHaveLength(0);
    expect(result.stderr).toContain(OTHER);
    expect(result.stderr).toContain(LOCKED);
    expect(result.stderr).toContain('ANDROID_SERIAL');
  });

  it('keeps a device the caller named when it is the locked serial', () => {
    const result = run([OTHER, LOCKED], LOCKED, ['--device', LOCKED, 'test', 'flow.yaml']);

    expect(result.status).toBe(0);
    expect(result.calls[0]).toBe(`--device ${LOCKED} test flow.yaml`);
  });

  it('keeps a matching device in the joined and udid forms', () => {
    const joined = run([OTHER, LOCKED], LOCKED, [`--device=${LOCKED}`, 'test', 'flow.yaml']);
    const udid = run([OTHER, LOCKED], LOCKED, ['--udid', LOCKED, 'test', 'flow.yaml']);
    const udidJoined = run([OTHER, LOCKED], LOCKED, [`--udid=${LOCKED}`, 'test', 'flow.yaml']);

    for (const result of [joined, udid, udidJoined]) {
      expect(result.status).toBe(0);
      expect(result.calls).toHaveLength(1);
    }
    expect(joined.calls[0]).toBe(`--device=${LOCKED} test flow.yaml`);
  });
});

/**
 * Scenario: the run is locked to one serial and the caller names a different
 * attached device, so the lock would serialise one handset while Maestro drives
 * the other.
 *
 * Expected behaviour: any explicit selector that differs from the locked serial
 * is refused before Maestro starts, naming both serials. Every occurrence is
 * checked, and an empty or missing value is refused.
 */
describe('the Maestro wrapper refuses a selector other than the locked serial', () => {
  const conflicting: [string, string[]][] = [
    ['--device VALUE', ['--device', OTHER, 'test', 'flow.yaml']],
    ['--device=VALUE', [`--device=${OTHER}`, 'test', 'flow.yaml']],
    ['--udid VALUE', ['--udid', OTHER, 'test', 'flow.yaml']],
    ['--udid=VALUE', [`--udid=${OTHER}`, 'test', 'flow.yaml']],
    ['a mismatch after a match', ['--device', LOCKED, '--udid', OTHER, 'test', 'flow.yaml']],
    ['a mismatch before a match', [`--udid=${OTHER}`, `--device=${LOCKED}`, 'test', 'flow.yaml']],
    ['a mismatch among aliases', [`--device=${LOCKED}`, '--udid', OTHER, 'test', 'flow.yaml']],
  ];

  it.each(conflicting)('refuses %s without launching Maestro', (_name, args) => {
    const result = run([OTHER, LOCKED], LOCKED, args, `Running on ${OTHER}`);

    expect(result.status).not.toBe(0);
    expect(result.calls).toHaveLength(0);
    expect(result.ran).toBe(false);
    expect(result.stderr).toContain(OTHER);
    expect(result.stderr).toContain(LOCKED);
  });

  it.each([
    ['an empty --device value', ['--device', '', 'test', 'flow.yaml']],
    ['an empty joined value', ['--device=', 'test', 'flow.yaml']],
    ['a --device with no value', ['test', 'flow.yaml', '--device']],
    ['a --udid with no value', ['--udid']],
  ])('refuses %s', (_name, args) => {
    const result = run([OTHER, LOCKED], LOCKED, args);

    expect(result.status).not.toBe(0);
    expect(result.calls).toHaveLength(0);
    expect(result.ran).toBe(false);
  });
});

/**
 * Scenario: two handsets are attached and the run is pinned to one of them, but
 * Maestro resolves `--device` the way it resolves `ANDROID_SERIAL`, by
 * enumerating every transport, and reports `Running on` the other handset.
 *
 * Expected behaviour: the wrapper reads the device Maestro says it is running
 * on, and when that is another attached handset it stops the run before the
 * flow does anything there and exits non-zero, naming both. A run on the
 * pinned handset passes its output and its exit code through unchanged.
 */
describe('the Maestro wrapper checks where the run landed', () => {
  it('stops a run Maestro put on another attached handset', () => {
    const result = run([OTHER, LOCKED], LOCKED, undefined, `Running on ${OTHER}`);

    expect(result.status).not.toBe(0);
    expect(result.ran).toBe(false);
    expect(result.stderr).toContain(OTHER);
    expect(result.stderr).toContain(LOCKED);
  });

  it('stops a sharded run that selected another handset', () => {
    const result = run([OTHER, LOCKED], LOCKED, undefined, `[shard 1] Selected device ${OTHER}`);

    expect(result.status).not.toBe(0);
    expect(result.ran).toBe(false);
  });

  it('lets a run on the pinned handset finish, with its output and exit code', () => {
    const result = run([OTHER, LOCKED], LOCKED, undefined, `Running on ${LOCKED}`, 3);

    expect(result.status).toBe(3);
    expect(result.ran).toBe(true);
    expect(result.stdout).toContain(`Running on ${LOCKED}`);
  });

  it('does not take a device line that names no attached serial as a mismatch', () => {
    const result = run([OTHER, LOCKED], LOCKED, undefined, 'Running on Pixel 6 - Android 14');

    expect(result.status).toBe(0);
    expect(result.ran).toBe(true);
  });
});

/**
 * Scenario: two sessions on one host run Maestro at once, each on its own
 * emulator and each holding that emulator's device lock. Maestro reaches its
 * on-device driver through a forward of one fixed host port, so the two runs
 * take the forward from each other and every flow fails on both.
 *
 * Expected behaviour: the wrapper also holds one lock for the whole host while
 * Maestro runs, so the second run starts only after the first has ended, and
 * while it waits it names who holds the lock.
 */
describe('the Maestro wrapper and the other runs on the host', () => {
  function hostRig() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'with-maestro-host-'));
    const listing = ['List of devices attached', `${LOCKED}\tdevice`, `${OTHER}\tdevice`, ''].join(
      '\n'
    );
    fs.writeFileSync(
      path.join(dir, 'adb'),
      `#!/usr/bin/env bash\nif [ "$1" = "devices" ]; then\n  cat <<'EOF'\n${listing}EOF\nfi\nexit 0\n`,
      { mode: 0o755 }
    );
    fs.writeFileSync(
      path.join(dir, 'maestro'),
      [
        '#!/usr/bin/env bash',
        `echo "start $ANDROID_SERIAL" >> "${dir}/runs.log"`,
        'sleep 1',
        `echo "end $ANDROID_SERIAL" >> "${dir}/runs.log"`,
        '',
      ].join('\n'),
      { mode: 0o755 }
    );
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      VELOQ_DEVICE_LOCK_DIR: dir,
      VELOQ_DEVICE_LOCK_HANDSET: '0',
      XDG_CONFIG_HOME: dir,
    };
    for (const name of [
      'ANDROID_SERIAL',
      'VELOQ_ALLOW_HANDSET',
      'VELOQ_DEVICE_SERIAL',
      'VELOQ_DEVICE_LOCK',
      'VELOQ_DEVICE_LOCK_PATH',
      'VELOQ_DEVICE_LOCK_HELD',
      'VELOQ_DEVICE_LOCK_AMBIGUOUS',
      'VELOQ_MAESTRO_LOCK',
      'VELOQ_MAESTRO_LOCK_PATH',
      'VELOQ_MAESTRO_LOCK_HELD',
    ]) {
      delete env[name];
    }
    return { dir, env };
  }

  function start(dir: string, env: NodeJS.ProcessEnv, serial: string) {
    const child = spawn('sh', [SCRIPT, 'test', 'flow.yaml'], {
      cwd: dir,
      env: { ...env, ANDROID_SERIAL: serial },
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));
    return new Promise<{ status: number | null; stderr: string }>((resolve) =>
      child.on('close', (status) => resolve({ status, stderr }))
    );
  }

  it('runs Maestro on one device of the host at a time', async () => {
    const { dir, env } = hostRig();

    const results = await Promise.all([start(dir, env, LOCKED), start(dir, env, OTHER)]);

    expect(results.map((r) => r.status)).toEqual([0, 0]);
    const runs = fs.readFileSync(path.join(dir, 'runs.log'), 'utf8').trim().split('\n');
    expect(runs).toHaveLength(4);
    expect(runs[0].split(' ')[0]).toBe('start');
    expect(runs[1]).toBe(runs[0].replace('start', 'end'));
    expect(runs[2].split(' ')[0]).toBe('start');
    expect(runs[3]).toBe(runs[2].replace('start', 'end'));
  });

  it('names the run that holds the host while another waits', async () => {
    const { dir, env } = hostRig();

    const first = start(dir, env, LOCKED);
    while (!fs.existsSync(path.join(dir, 'runs.log'))) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const second = await start(dir, env, OTHER);
    await first;

    expect(second.status).toBe(0);
    expect(second.stderr).toContain('with-maestro: another Maestro run holds this host');
    expect(second.stderr).toContain(`serial=${LOCKED}`);
  });

  it('serialises a run that already holds its device lock', async () => {
    const { dir, env } = hostRig();
    const held = { ...env, VELOQ_DEVICE_LOCK_HELD: '1' };

    await Promise.all([start(dir, held, LOCKED), start(dir, held, OTHER)]);

    const runs = fs.readFileSync(path.join(dir, 'runs.log'), 'utf8').trim().split('\n');
    expect(runs[1]).toBe(runs[0].replace('start', 'end'));
  });
});
