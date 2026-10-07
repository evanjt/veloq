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
  shell) shift; cmd=$(printf '%s' "$*" | sed "s#/data/local/tmp#${handset}#g"); exec sh -c "$cmd" ;;
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
