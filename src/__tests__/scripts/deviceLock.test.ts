/**
 * Scenario: two agent sessions measure on the one handset at the same moment.
 * Claiming a task locks the task, not the hardware, and two tasks can need the
 * same phone.
 *
 * Expected behaviour: the second waits. Two sessions measuring at once can have
 * one reset `gfxinfo` and read a frame histogram back that carries the other's
 * map load, and nothing in either run says so.
 */
import { ChildProcess, spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const projectRoot = path.join(__dirname, '../../..');
const script = path.join(projectRoot, 'scripts/with-device-lock.sh');
/** Sourced by both takers of the lock, so the path is derived in one place. */
const lockPath = path.join(projectRoot, 'scripts/device-lock-path.sh');

/** Invented serials, so a lock derived from one names no handset anybody drives. */
const PINNED = '198.51.100.7:5555';
const OTHER = '198.51.100.8:5555';
const PINNED_LOCK = 'veloq-device-198.51.100.7_5555.lock';

/**
 * An environment whose lock directory and `adb` are this test's own, so a taker
 * that derives its lock path from the serial derives it under a temporary
 * directory and reads the attached handsets from a stub rather than the machine.
 */
function isolated(attached: string[] = []): NodeJS.ProcessEnv {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-device-'));
  const listing = attached.map((serial) => `${serial}\\tdevice\\n`).join('');
  fs.writeFileSync(
    path.join(dir, 'adb'),
    `#!/bin/sh\nprintf 'List of devices attached\\n${listing}'\n`,
    { mode: 0o755 }
  );
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${dir}:${process.env.PATH}`,
    VELOQ_DEVICE_LOCK_DIR: dir,
    VELOQ_DEVICE_LOCK_HANDSET: '0',
    // The suite's own test handsets, so no allowlist on the machine running it applies.
    VELOQ_TEST_HANDSETS: `${PINNED} ${OTHER}`,
    XDG_CONFIG_HOME: dir,
  };
  for (const name of [
    'VELOQ_ALLOW_HANDSET',
    'ANDROID_SERIAL',
    'VELOQ_DEVICE_SERIAL',
    'VELOQ_DEVICE_LOCK',
    'VELOQ_DEVICE_LOCK_PATH',
    'VELOQ_DEVICE_LOCK_HELD',
    'VELOQ_DEVICE_LOCK_AMBIGUOUS',
  ]) {
    delete env[name];
  }
  return env;
}

/** A lock of this test's own, so nothing here waits on the fleet's handset. */
function privateLock(): NodeJS.ProcessEnv {
  const env = isolated();
  return { ...env, VELOQ_DEVICE_LOCK: path.join(env.VELOQ_DEVICE_LOCK_DIR!, 'lock') };
}

/**
 * Scenario: a session holds the machine's lock for a handset while this suite
 * runs, which is the ordinary state of a machine where jobs drive phones.
 *
 * Expected behaviour: nothing here waits on it. The suite holds the machine's
 * lock for the serial it pins for its whole run, so a taker that derives its
 * path outside its temporary directory blocks and times out rather than
 * passing on a quiet machine.
 */
const machineLockDir = fs.existsSync(`/tmp/claude-${os.userInfo().uid}`)
  ? `/tmp/claude-${os.userInfo().uid}`
  : '/tmp';
const hasFlock = spawnSync('sh', ['-c', 'command -v flock']).status === 0;
let machineHold: ChildProcess | undefined;

beforeAll(async () => {
  if (!hasFlock) return;
  const held = path.join(machineLockDir, PINNED_LOCK);
  // The holder execs into the sleep, so killing it closes the descriptor the lock is on.
  machineHold = spawn('sh', ['-c', 'exec 9>"$1" && flock 9 && exec sleep 3600', 'sh', held], {
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) {
    if (spawnSync('flock', ['-n', held, 'true']).status !== 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`could not hold ${held}`);
});

afterAll(() => {
  machineHold?.kill();
});

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
    const env: NodeJS.ProcessEnv = { ...isolated(), ANDROID_SERIAL: PINNED };
    const shown = spawnSync(script, ['sh', '-c', 'printf %s "$VELOQ_DEVICE_LOCK_PATH"'], {
      encoding: 'utf8',
      env,
      timeout: 10000,
    });
    expect(shown.status).toBe(0);
    expect(shown.stdout).toBe(path.join(env.VELOQ_DEVICE_LOCK_DIR!, PINNED_LOCK));
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
   * Expected behaviour: the wrapper refuses rather than guessing. Guessing takes
   * one handset's lock for a session that drives the other, so two sessions
   * can hold different locks and drive the one phone, which is the
   * collision the lock exists to stop.
   */
  it('refuses to guess a serial when several handsets are attached', () => {
    const env = isolated([OTHER, PINNED]);

    for (const taker of ['scripts/with-device-lock.sh', 'scripts/device-lock-shell.sh']) {
      const run = spawnSync(path.join(projectRoot, taker), ['sh', '-c', 'echo ran'], {
        encoding: 'utf8',
        env,
        timeout: 10000,
      });
      expect(run.stdout).not.toContain('ran');
      expect(run.status).not.toBe(0);
      expect(run.stderr).toContain(OTHER);
      expect(run.stderr).toContain(PINNED);
      expect(run.stderr).toContain('ANDROID_SERIAL');
    }
  });

  it('locks the pinned handset when several are attached and one is named', () => {
    const env: NodeJS.ProcessEnv = { ...isolated([OTHER, PINNED]), ANDROID_SERIAL: PINNED };

    const run = spawnSync(
      path.join(projectRoot, 'scripts/with-device-lock.sh'),
      ['sh', '-c', 'echo "$VELOQ_DEVICE_LOCK_PATH"'],
      { encoding: 'utf8', env, timeout: 10000 }
    );
    expect(run.status).toBe(0);
    expect(run.stdout).toContain(PINNED_LOCK);
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
            env: { ...isolated(), VELOQ_DEVICE_LOCK: `${marker}.lock` },
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
 * Scenario: a headless run resolves the lock to a phone nobody designated for
 * testing, such as someone's own handset left connected to the machine.
 *
 * Expected behaviour: the lock refuses before anything reaches the phone. The
 * rigs behind it uninstall the app or clear its data, so a run that lands on
 * the wrong handset wipes a real library. Emulators, an allowlisted serial and
 * a run that names the serial in `VELOQ_ALLOW_HANDSET` pass.
 */
describe('a handset that is not a test handset', () => {
  /** An invented serial on no allowlist. */
  const UNLISTED = '192.0.2.40:5555';
  /** An invented serial the allowlist cases list beside it. */
  const LISTED = '203.0.113.9:5555';
  const EMULATOR = 'emulator-5554';

  /** One attached handset, no allowlist anywhere, and a lock of the test's own. */
  function unlisted(attached: string[] = [UNLISTED]): NodeJS.ProcessEnv {
    const env = isolated(attached);
    return {
      ...env,
      VELOQ_TEST_HANDSETS: '',
      VELOQ_DEVICE_LOCK: path.join(env.VELOQ_DEVICE_LOCK_DIR!, 'lock'),
    };
  }

  function take(env: NodeJS.ProcessEnv, taker = 'scripts/with-device-lock.sh') {
    return spawnSync(path.join(projectRoot, taker), ['sh', '-c', 'echo ran'], {
      encoding: 'utf8',
      env,
      timeout: 10000,
    });
  }

  function expectRefused(run: ReturnType<typeof take>, serial = UNLISTED) {
    expect(run.stdout).not.toContain('ran');
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain(serial);
    expect(run.stderr).toContain('VELOQ_ALLOW_HANDSET');
  }

  it('refuses an attached handset on no allowlist', () => {
    expectRefused(take(unlisted()));
  });

  it('refuses through the hand-taken lock too', () => {
    expectRefused(take(unlisted(), 'scripts/device-lock-shell.sh'));
  });

  it('sends the refused handset nothing', () => {
    const env = unlisted();
    const calls = path.join(env.VELOQ_DEVICE_LOCK_DIR!, 'adb-calls');
    fs.writeFileSync(
      path.join(env.VELOQ_DEVICE_LOCK_DIR!, 'adb'),
      `#!/bin/sh\necho "$*" >> ${calls}\nprintf 'List of devices attached\\n${UNLISTED}\\tdevice\\n'\n`,
      { mode: 0o755 }
    );
    expectRefused(take({ ...env, VELOQ_DEVICE_LOCK_HANDSET: '1' }));
    expect(fs.readFileSync(calls, 'utf8').trim().split('\n')).toEqual(['devices']);
  });

  it('runs on an emulator', () => {
    const run = take(unlisted([EMULATOR]));
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('ran');
  });

  it('runs on an iOS simulator, whose UDID is a UUID, and not on a phone-shaped UDID', () => {
    const simulator = take({
      ...unlisted(),
      ANDROID_SERIAL: '00000000-0000-4000-8000-0000000000aa',
    });
    expect(simulator.status).toBe(0);
    expect(simulator.stdout).toContain('ran');
    expectRefused(
      take({ ...unlisted(), ANDROID_SERIAL: '00008110-000A1B2C3D4E5F60' }),
      '00008110-000A1B2C3D4E5F60'
    );
  });

  it('runs on a serial listed in VELOQ_TEST_HANDSETS', () => {
    const run = take({ ...unlisted(), VELOQ_TEST_HANDSETS: `${LISTED} ${UNLISTED}` });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('ran');
  });

  it('runs on a serial listed in the allowlist file, ignoring comment lines', () => {
    const env = unlisted();
    delete env.VELOQ_TEST_HANDSETS;
    const file = path.join(env.XDG_CONFIG_HOME!, 'veloq/test-handsets');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `# the bench phone\n${LISTED}\n  ${UNLISTED}  \n`);
    const run = take(env);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('ran');

    fs.writeFileSync(file, `# ${UNLISTED}\n${LISTED}\n`);
    expectRefused(take(env));
  });

  it('runs when the run names the serial in VELOQ_ALLOW_HANDSET', () => {
    const run = take({ ...unlisted(), VELOQ_ALLOW_HANDSET: UNLISTED });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('ran');
  });

  it('still refuses when VELOQ_ALLOW_HANDSET names another serial', () => {
    expectRefused(take({ ...unlisted(), VELOQ_ALLOW_HANDSET: LISTED }));
  });

  it('refuses an unlisted ANDROID_SERIAL even with an emulator attached', () => {
    expectRefused(take({ ...unlisted([EMULATOR, UNLISTED]), ANDROID_SERIAL: UNLISTED }));
  });

  it('runs as before with nothing attached', () => {
    const run = take(unlisted([]));
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('ran');
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
    const env = privateLock();
    const run = spawnSync(shell, ['sh', '-c', `${script} echo through`], {
      encoding: 'utf8',
      env,
      timeout: 10000,
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('through');
  });

  it('derives the same lock path the wrapper does', () => {
    const env: NodeJS.ProcessEnv = { ...isolated(), ANDROID_SERIAL: PINNED };
    const show = (target: string) =>
      spawnSync(target, ['sh', '-c', 'printf %s "$VELOQ_DEVICE_LOCK_PATH"'], {
        encoding: 'utf8',
        env,
        timeout: 10000,
      });
    const held = show(shell);
    expect(held.status).toBe(0);
    expect(held.stdout).toBe(path.join(env.VELOQ_DEVICE_LOCK_DIR!, PINNED_LOCK));
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
            env: { ...isolated(), VELOQ_DEVICE_LOCK: `${marker}.lock` },
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
 * Scenario: one handset drops off the network and its transport stays in
 * `adb devices` as `offline`, while another is connected and healthy.
 *
 * Expected behaviour: the run refuses and names the offline entry. Maestro
 * enumerates every transport and answers "Device <the healthy one> was
 * requested, but it is not connected", which reads as the named handset having
 * dropped rather than an unrelated entry poisoning the enumeration. Seen on
 * Maestro 2.1.0: `--device`, `--udid`, `-p android` and
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
    const stub: { env: NodeJS.ProcessEnv; ran: string } = {
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        VELOQ_DEVICE_LOCK: path.join(dir, 'lock'),
        VELOQ_DEVICE_LOCK_HELD: '',
        ANDROID_SERIAL: '203.0.113.11:5555',
        XDG_CONFIG_HOME: dir,
      },
      ran,
    };
    // The pinned handset is the test handset, whatever the machine's own allowlist says.
    stub.env.VELOQ_TEST_HANDSETS = stub.env.ANDROID_SERIAL;
    delete stub.env.VELOQ_ALLOW_HANDSET;
    return stub;
  }

  const HEALTHY = 'List of devices attached\n203.0.113.11:5555\tdevice';
  const WITH_OFFLINE = `${HEALTHY}\n203.0.113.12:5555\toffline`;

  it('refuses while a transport is offline, and names it', () => {
    const { env, ran } = stubbed(WITH_OFFLINE);

    const run = spawnSync(wrapper, ['test', '.maestro/'], { encoding: 'utf8', env });

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('203.0.113.12:5555');
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
