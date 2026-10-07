/**
 * Scenario: two agent sessions measure on the one handset at the same moment.
 * `docket start` locks the item, not the hardware, and two items can need the
 * same phone.
 *
 * Expected behaviour: the second waits. Two sessions measuring at once on
 * 2026-09-15 had one reset `gfxinfo` and read a frame histogram back that
 * carried the other's map load, and nothing in either run said so.
 */
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const projectRoot = path.join(__dirname, '../../..');
const script = path.join(projectRoot, 'scripts/with-device-lock.sh');
/** Sourced by both takers of the lock, so the path is derived in one place. */
const lockPath = path.join(projectRoot, 'scripts/device-lock-path.sh');

/** A lock of this test's own, so nothing here waits on the fleet's handset. */
function privateLock(): NodeJS.ProcessEnv {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-device-'));
  return { ...process.env, VELOQ_DEVICE_LOCK: path.join(dir, 'lock'), VELOQ_DEVICE_LOCK_HELD: '' };
}

// Which scripts drive the handset, and that each takes this lock, is
// `scripts/lint-device-drivers.mjs`, which finds them rather than listing them.
describe('the handset takes a lock of its own', () => {
  it('is not the build lock, which a build holds for a quarter of an hour', () => {
    const source = fs.readFileSync(lockPath, 'utf8');
    expect(source).toContain('veloq-device-');
    expect(source).not.toContain('veloq-android-build.lock');
    // A session-private temp directory would be a lock nobody else can see.
    expect(source).not.toContain('TMPDIR');
  });

  it('keys the lock on the serial, so a phone and an emulator do not queue', () => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ANDROID_SERIAL: '192.168.1.118:5555',
      VELOQ_DEVICE_LOCK_HANDSET: '0',
    };
    delete env.VELOQ_DEVICE_LOCK;
    delete env.VELOQ_DEVICE_LOCK_HELD;
    const shown = spawnSync(script, ['sh', '-c', 'echo done'], { encoding: 'utf8', env });
    expect(shown.status).toBe(0);
    // The colon cannot go into a filename, so the serial is sanitised into one.
    const source = fs.readFileSync(lockPath, 'utf8');
    expect(source).toContain('ANDROID_SERIAL');
    expect(source).toMatch(/tr -c '[^']+'/);
  });

  it('passes the command through and keeps its exit code', () => {
    const env = privateLock();
    const ok = spawnSync(script, ['echo', 'measured'], { encoding: 'utf8', env });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain('measured');
    expect(spawnSync(script, ['false'], { encoding: 'utf8', env }).status).not.toBe(0);
  });

  it('takes nothing when it is already held, so a run cannot wait on itself', () => {
    // B624 one layer down: a flock is held per open file description, so a
    // second take blocks the child against its own parent.
    const env = { ...privateLock(), VELOQ_DEVICE_LOCK_HELD: '1' };
    const run = spawnSync(script, ['sh', '-c', 'echo through'], {
      encoding: 'utf8',
      env,
      timeout: 10000,
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('through');
  });

  /**
   * Scenario: both handsets are attached and the run pins one of them inside
   * the shell the wrapper started, which is how every hand-driven measurement
   * reaches a named device.
   *
   * Expected behaviour: the wrapper refuses rather than guessing. Guessing took
   * the OnePlus's lock for a session that drove the S22 on 2026-09-19, so two
   * sessions could hold different locks and drive the one phone, which is the
   * collision the lock exists to stop.
   */
  it('refuses to guess a serial when several handsets are attached', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-adb-'));
    fs.writeFileSync(
      path.join(dir, 'adb'),
      "#!/bin/sh\nprintf 'List of devices attached\\n10.0.0.3:5555\\tdevice\\n192.168.1.118:5555\\tdevice\\n'\n"
    );
    fs.chmodSync(path.join(dir, 'adb'), 0o755);
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${dir}:${process.env.PATH}` };
    delete env.ANDROID_SERIAL;
    delete env.VELOQ_DEVICE_LOCK;
    delete env.VELOQ_DEVICE_LOCK_HELD;

    for (const taker of ['scripts/with-device-lock.sh', 'scripts/device-lock-shell.sh']) {
      const run = spawnSync(path.join(projectRoot, taker), ['sh', '-c', 'echo ran'], {
        encoding: 'utf8',
        env,
        timeout: 10000,
      });
      expect(run.stdout).not.toContain('ran');
      expect(run.status).not.toBe(0);
      expect(run.stderr).toContain('10.0.0.3:5555');
      expect(run.stderr).toContain('192.168.1.118:5555');
      expect(run.stderr).toContain('ANDROID_SERIAL');
    }
  });

  it('locks the pinned handset when several are attached and one is named', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-adb-'));
    fs.writeFileSync(
      path.join(dir, 'adb'),
      "#!/bin/sh\nprintf 'List of devices attached\\n10.0.0.3:5555\\tdevice\\n192.168.1.118:5555\\tdevice\\n'\n"
    );
    fs.chmodSync(path.join(dir, 'adb'), 0o755);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      ANDROID_SERIAL: '192.168.1.118:5555',
    };
    delete env.VELOQ_DEVICE_LOCK;
    delete env.VELOQ_DEVICE_LOCK_HELD;

    const run = spawnSync(
      path.join(projectRoot, 'scripts/with-device-lock.sh'),
      ['sh', '-c', 'echo "$VELOQ_DEVICE_LOCK_PATH"'],
      { encoding: 'utf8', env, timeout: 10000 }
    );
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('veloq-device-192.168.1.118_5555.lock');
  });

  it('serialises two runs rather than letting them interleave', async () => {
    const marker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-device-')), 'order');
    const run = (tag: string) =>
      new Promise<void>((resolve) => {
        const child = spawn(
          script,
          ['sh', '-c', `echo ${tag}-in >> ${marker}; sleep 0.4; echo ${tag}-out >> ${marker}`],
          {
            stdio: 'ignore',
            env: {
              ...process.env,
              VELOQ_DEVICE_LOCK: `${marker}.lock`,
              VELOQ_DEVICE_LOCK_HELD: '',
            },
          }
        );
        child.on('close', () => resolve());
      });

    await Promise.all([run('a'), run('b')]);

    const order = fs.readFileSync(marker, 'utf8').trim().split('\n');
    expect(order).toHaveLength(4);
    expect(order[1]).toBe(`${order[0].split('-')[0]}-out`);
  });
});

/**
 * Scenario: an agent drives `adb` by hand under the documented bare `flock`,
 * then reaches for a `scripts/` helper inside that shell.
 *
 * Expected behaviour: the helper runs. Under a bare `flock` it blocked on the
 * lock its own parent held and said "another session holds", so the natural
 * reading was a busy fleet rather than the caller being its own blocker.
 */
/**
 * Scenario: a Maestro flow runs while another session measures on the same handset.
 *
 * Expected behaviour: the flow waits for the lock. `launchApp` issues `am force-stop`
 * and `clearState` wipes the app's data, so a flow does not share the handset, it
 * resets it. On 2026-09-19 one took the process out from under a CPU measurement
 * that was holding the lock, which cost that measurement.
 */
describe('every npm script that reaches the handset', () => {
  const scripts: Record<string, string> = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')
  ).scripts;

  /**
   * Commands that start the app, install over it or drive its input. Maestro
   * counts whether it is reached bare or through `with-maestro.sh`, and
   * `lint-maestro-ids` does not: it reads the flow files off disk.
   */
  const REACHES_HANDSET = /maestro(\.sh)?\s+(test|--)|\badb\b|connectedDebugAndroidTest/;

  /** The two wrappers that take the lock: directly, or through the Maestro one. */
  const TAKES_THE_LOCK = /with-device-lock\.sh|with-maestro\.sh/;

  it('runs through the device lock', () => {
    const unlocked = Object.entries(scripts)
      .filter(([, command]) => REACHES_HANDSET.test(command))
      .filter(([, command]) => !TAKES_THE_LOCK.test(command))
      .map(([name]) => name);
    expect(unlocked).toEqual([]);
  });
});

describe('a hand-taken lock', () => {
  const shell = path.join(projectRoot, 'scripts/device-lock-shell.sh');

  it('marks itself taken, so a helper underneath runs rather than waiting', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-device-'));
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      VELOQ_DEVICE_LOCK: path.join(dir, 'lock'),
      VELOQ_DEVICE_LOCK_HELD: '',
    };
    const run = spawnSync(shell, ['sh', '-c', `${script} echo through`], {
      encoding: 'utf8',
      env,
      timeout: 10000,
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('through');
  });

  it('derives the same lock path the wrapper does', () => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ANDROID_SERIAL: '192.168.1.118:5555',
      VELOQ_DEVICE_LOCK_HANDSET: '0',
    };
    delete env.VELOQ_DEVICE_LOCK;
    delete env.VELOQ_DEVICE_LOCK_HELD;
    const show = (target: string) =>
      spawnSync(target, ['sh', '-c', 'printf %s "$VELOQ_DEVICE_LOCK_PATH"'], {
        encoding: 'utf8',
        env,
      });
    const held = show(shell);
    expect(held.status).toBe(0);
    expect(held.stdout).toContain('veloq-device-192.168.1.118_5555.lock');
    expect(show(script).stdout).toBe(held.stdout);
  });

  it('serialises against the wrapper, so two sessions still queue', async () => {
    const marker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-device-')), 'order');
    const run = (target: string, tag: string) =>
      new Promise<void>((resolve) => {
        const child = spawn(
          target,
          ['sh', '-c', `echo ${tag}-in >> ${marker}; sleep 0.4; echo ${tag}-out >> ${marker}`],
          {
            stdio: 'ignore',
            env: {
              ...process.env,
              VELOQ_DEVICE_LOCK: `${marker}.lock`,
              VELOQ_DEVICE_LOCK_HELD: '',
            },
          }
        );
        child.on('close', () => resolve());
      });

    await Promise.all([run(shell, 'a'), run(script, 'b')]);

    const order = fs.readFileSync(marker, 'utf8').trim().split('\n');
    expect(order).toHaveLength(4);
    expect(order[1]).toBe(`${order[0].split('-')[0]}-out`);
  });

  it('is what the wrapper header and CLAUDE.md tell an agent to take', () => {
    expect(fs.readFileSync(script, 'utf8')).toContain('device-lock-shell.sh');
    // The waiting line has to admit the caller may be its own blocker.
    expect(fs.readFileSync(script, 'utf8')).toMatch(/holds.*including you|you may be holding/i);
  });
});

/**
 * Scenario: the OnePlus drops off the network and its transport stays in
 * `adb devices` as `offline`, while the S22 is connected and healthy.
 *
 * Expected behaviour: the run refuses and names the offline entry. Maestro
 * enumerates every transport and answers "Device <the healthy one> was
 * requested, but it is not connected", which reads as the named handset having
 * dropped rather than an unrelated entry poisoning the enumeration. Measured
 * 2026-09-19 on Maestro 2.1.0: `--device`, `--udid`, `-p android` and
 * `ANDROID_SERIAL` all behaved the same way.
 */
describe('the Maestro wrapper', () => {
  const wrapper = path.join(projectRoot, 'scripts/with-maestro.sh');

  /** A PATH holding stub `adb` and `maestro`, so nothing reaches a handset. */
  function stubbed(devices: string): { env: NodeJS.ProcessEnv; ran: string } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-maestro-'));
    const ran = path.join(dir, 'ran');
    fs.writeFileSync(path.join(dir, 'adb'), `#!/bin/sh\ncat <<'EOF'\n${devices}\nEOF\n`, {
      mode: 0o755,
    });
    fs.writeFileSync(path.join(dir, 'maestro'), `#!/bin/sh\necho "$@" > ${ran}\n`, { mode: 0o755 });
    return {
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        VELOQ_DEVICE_LOCK: path.join(dir, 'lock'),
        VELOQ_DEVICE_LOCK_HELD: '',
        ANDROID_SERIAL: '192.168.1.118:5555',
      },
      ran,
    };
  }

  const HEALTHY = 'List of devices attached\n192.168.1.118:5555\tdevice';
  const WITH_OFFLINE = `${HEALTHY}\n10.0.0.3:5555\toffline`;

  it('refuses while a transport is offline, and names it', () => {
    const { env, ran } = stubbed(WITH_OFFLINE);

    const run = spawnSync(wrapper, ['test', '.maestro/'], { encoding: 'utf8', env });

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('10.0.0.3:5555');
    expect(fs.existsSync(ran)).toBe(false);
  });

  it('says Maestro refuses every device, not the one that dropped', () => {
    const { env } = stubbed(WITH_OFFLINE);

    const run = spawnSync(wrapper, ['test', '.maestro/'], { encoding: 'utf8', env });

    expect(run.stderr).toMatch(/every device|all devices/i);
    expect(run.stderr).toContain('adb disconnect');
  });

  it('runs Maestro with its arguments when every transport is healthy', () => {
    const { env, ran } = stubbed(HEALTHY);

    const run = spawnSync(wrapper, ['test', '.maestro/', '--include-tags=tier0'], {
      encoding: 'utf8',
      env,
    });

    expect(run.status).toBe(0);
    expect(fs.readFileSync(ran, 'utf8')).toContain('test .maestro/ --include-tags=tier0');
  });

  it('takes the device lock, so a flow does not reset another run', () => {
    const source = fs.readFileSync(wrapper, 'utf8');
    expect(source).toContain('with-device-lock.sh');
    expect(source).toContain('VELOQ_DEVICE_LOCK_HELD');
  });
});
