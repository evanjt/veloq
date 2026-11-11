/**
 * Scenario: two hosts drive one network-attached handset. Each host has its own
 * local lock file, so a flock on it serialises nobody on the other host.
 *
 * Expected behaviour: the lock is also taken on the handset, so the second taker
 * refuses while the first holds and names the first's host, item and age.
 */
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const projectRoot = path.join(__dirname, '../../..');
const wrapper = path.join(projectRoot, 'scripts/with-device-lock.sh');
const shell = path.join(projectRoot, 'scripts/device-lock-shell.sh');
const handsetLock = path.join(projectRoot, 'scripts/device-lock-handset.sh');

/** The shell's clock: the suite's own `Date` is frozen. */
const nowSeconds = () => Number(spawnSync('date', ['+%s'], { encoding: 'utf8' }).stdout.trim());

const SERIAL = '192.0.2.7:5555';

/** A handset directory shared by every run, behind a stub `adb` that maps `/data/local/tmp` onto it. */
function fakeHandset() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-handset-'));
  const bin = path.join(root, 'bin');
  const handset = path.join(root, 'handset');
  fs.mkdirSync(bin);
  fs.mkdirSync(handset);
  fs.writeFileSync(
    path.join(bin, 'adb'),
    `#!/bin/sh
[ "$1" = "-s" ] && shift 2
case "$1" in
  devices) printf 'List of devices attached\\n${SERIAL}\\tdevice\\n'; exit 0 ;;
  shell) shift; cat >/dev/null; cmd=$(printf '%s' "$*" | sed "s#/data/local/tmp#${handset}#g"); exec sh -c "$cmd" ;;
esac
exit 0
`,
    { mode: 0o755 }
  );
  const lockDir = path.join(handset, 'veloq-device-lock');
  /** One run's environment: its own local lock file, so it stands in for its own host. */
  const host = (name: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    ANDROID_SERIAL: SERIAL,
    VELOQ_TEST_HANDSETS: SERIAL,
    VELOQ_ALLOW_HANDSET: '',
    VELOQ_DEVICE_LOCK: path.join(root, `${name}.lock`),
    VELOQ_DEVICE_LOCK_HELD: '',
    VELOQ_DEVICE_LOCK_HANDSET: '1',
    VELOQ_DEVICE_LOCK_WAIT: '0',
    VELOQ_DEVICE_HOST: name,
    VELOQ_DEVICE_ITEM: `item-${name}`,
    ...extra,
  });
  return { root, lockDir, host };
}

describe('the lock held on the handset', () => {
  /**
   * Scenario: a caller pipes its input into the wrapper, which runs the command
   * asynchronously. `adb shell` also reads stdin unless `-n` is given, so the
   * lock's own calls to the handset must not take the input before the command
   * starts.
   *
   * Expected behaviour: the wrapped command reads the piped input unchanged.
   */
  it('hands its piped input down to the wrapped command', () => {
    const { host } = fakeHandset();
    const run = spawnSync(handsetLock, ['cat'], {
      encoding: 'utf8',
      input: 'hi',
      env: host('alpha', { VELOQ_DEVICE_SERIAL: SERIAL }),
      timeout: 10000,
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toBe('hi');
  });

  it('runs the wrapped command when its own input is closed', () => {
    const { host } = fakeHandset();
    const run = spawnSync('sh', ['-c', `${handsetLock} echo ran <&-`], {
      encoding: 'utf8',
      env: host('alpha', { VELOQ_DEVICE_SERIAL: SERIAL }),
      timeout: 10000,
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toBe('ran\n');
  });

  it('runs a wrapped shell that reads its commands from the piped input', () => {
    const { host } = fakeHandset();
    const run = spawnSync(handsetLock, ['sh'], {
      encoding: 'utf8',
      input: 'echo one\n',
      env: host('alpha', { VELOQ_DEVICE_SERIAL: SERIAL }),
      timeout: 10000,
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toBe('one\n');
  });

  it('refuses a second host while the first holds, naming the holder', async () => {
    const { host, lockDir } = fakeHandset();
    const ready = path.join(path.dirname(lockDir), 'ready');
    const first = spawn(wrapper, ['sh', '-c', `touch ${ready}; sleep 3`], {
      stdio: 'ignore',
      env: host('alpha'),
    });
    for (let i = 0; i < 100 && !fs.existsSync(ready); i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(fs.existsSync(lockDir)).toBe(true);

    const second = spawnSync(wrapper, ['sh', '-c', 'echo ran'], {
      encoding: 'utf8',
      env: host('beta'),
      timeout: 10000,
    });
    first.kill();

    expect(second.stdout).not.toContain('ran');
    expect(second.status).not.toBe(0);
    expect(second.stderr).toContain('alpha');
    expect(second.stderr).toContain('item-alpha');
  });

  it('refuses the hand-taken shell the same way', async () => {
    const { host, lockDir } = fakeHandset();
    const ready = path.join(path.dirname(lockDir), 'ready');
    const first = spawn(shell, ['sh', '-c', `touch ${ready}; sleep 3`], {
      stdio: 'ignore',
      env: host('alpha'),
    });
    for (let i = 0; i < 100 && !fs.existsSync(ready); i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const second = spawnSync(shell, ['sh', '-c', 'echo ran'], {
      encoding: 'utf8',
      env: host('beta'),
      timeout: 10000,
    });
    first.kill();
    expect(second.stdout).not.toContain('ran');
    expect(second.status).not.toBe(0);
    expect(second.stderr).toContain('alpha');
  });

  it('releases on exit, keeping the command exit code, so the next host can take it', () => {
    const { host, lockDir } = fakeHandset();
    const failed = spawnSync(wrapper, ['sh', '-c', 'exit 7'], { env: host('alpha') });
    expect(failed.status).toBe(7);
    expect(fs.existsSync(lockDir)).toBe(false);

    const next = spawnSync(wrapper, ['echo', 'ran'], { encoding: 'utf8', env: host('beta') });
    expect(next.status).toBe(0);
    expect(next.stdout).toContain('ran');
  });

  it('takes it a second time for nobody underneath a hold', () => {
    const { host, lockDir } = fakeHandset();
    const run = spawnSync(
      shell,
      ['sh', '-c', `${wrapper} sh -c 'test -d ${lockDir} && echo through'`],
      { encoding: 'utf8', env: host('alpha'), timeout: 10000 }
    );
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('through');
  });

  it('refuses a hold whose directory is fresh and has no holder line yet', () => {
    const { host, lockDir } = fakeHandset();
    fs.mkdirSync(lockDir);
    const run = spawnSync(wrapper, ['echo', 'ran'], { encoding: 'utf8', env: host('beta') });
    expect(run.status).not.toBe(0);
    expect(run.stdout).not.toContain('ran');
    expect(run.stderr).toContain('held');
    expect(run.stderr).not.toContain('taking over');
    expect(fs.existsSync(lockDir)).toBe(true);
  });

  it('refuses a hold whose holder line is still empty while it is being written', () => {
    const { host, lockDir } = fakeHandset();
    fs.mkdirSync(lockDir);
    fs.writeFileSync(path.join(lockDir, 'holder'), '');
    const run = spawnSync(wrapper, ['echo', 'ran'], { encoding: 'utf8', env: host('beta') });
    expect(run.status).not.toBe(0);
    expect(run.stdout).not.toContain('ran');
    expect(run.stderr).toContain('held');
    expect(fs.existsSync(lockDir)).toBe(true);
  });

  it('takes over a hold with no holder line once its directory is past the grace', () => {
    const { host, lockDir } = fakeHandset();
    fs.mkdirSync(lockDir);
    fs.utimesSync(lockDir, 1000, 1000);
    const run = spawnSync(wrapper, ['echo', 'ran'], { encoding: 'utf8', env: host('beta') });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('ran');
    expect(run.stderr).toMatch(/taking over .* aged \d+s/);
  });

  it('takes over a holder older than the stated limit', () => {
    const { host, lockDir } = fakeHandset();
    fs.mkdirSync(lockDir);
    fs.writeFileSync(
      path.join(lockDir, 'holder'),
      `host=gone pid=1 item=old since=${nowSeconds() - 99999}\n`
    );
    const run = spawnSync(wrapper, ['echo', 'ran'], {
      encoding: 'utf8',
      env: host('beta', { VELOQ_DEVICE_LOCK_MAX_AGE: '3600' }),
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('ran');
  });

  it('takes over a holder on this host whose process is dead', () => {
    const { host, lockDir } = fakeHandset();
    fs.mkdirSync(lockDir);
    fs.writeFileSync(
      path.join(lockDir, 'holder'),
      `host=alpha pid=2147483646 item=old since=${nowSeconds()}\n`
    );
    const run = spawnSync(wrapper, ['echo', 'ran'], { encoding: 'utf8', env: host('alpha') });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('ran');
  });

  it('refuses a recent holder on another host even when its pid means nothing here', () => {
    const { host, lockDir } = fakeHandset();
    fs.mkdirSync(lockDir);
    fs.writeFileSync(
      path.join(lockDir, 'holder'),
      `host=alpha pid=2147483646 item=busy since=${nowSeconds()}\n`
    );
    const run = spawnSync(wrapper, ['echo', 'ran'], { encoding: 'utf8', env: host('beta') });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('busy');
  });

  it('takes nothing on the handset when no handset is attached to name', () => {
    const { host, root } = fakeHandset();
    const bin = path.join(root, 'empty');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'adb'), "#!/bin/sh\necho 'List of devices attached'\n", {
      mode: 0o755,
    });
    const env = host('alpha');
    delete env.ANDROID_SERIAL;
    env.PATH = `${bin}:${env.PATH}`;
    const run = spawnSync(wrapper, ['echo', 'ran'], { encoding: 'utf8', env });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('ran');
  });
});
