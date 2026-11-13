/**
 * Scenario: several sessions share one Mac and its one booted simulator. One
 * installs a build while another is reading a screen or a memory figure off
 * the build it installed, and neither run says anything.
 *
 * Expected behaviour: the simulator lock lets one taker hold a udid at a time.
 * A second taker refuses and names the first's host, item and start, a nested
 * call under a hold runs without blocking, and a hold is released when its
 * command ends, whatever its exit code.
 */
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const projectRoot = path.join(__dirname, '../../..');
const wrapper = path.join(projectRoot, 'scripts/with-simulator-lock.sh');

/** The shell's clock: the suite's own `Date` is frozen. */
const nowSeconds = () => Number(spawnSync('date', ['+%s'], { encoding: 'utf8' }).stdout.trim());

const UDID = '00000000-AAAA-BBBB-CCCC-111111111111';
const OTHER = '00000000-AAAA-BBBB-CCCC-222222222222';

/** A temp HOME and a stub `xcrun` that lists the booted simulators given. */
function fakeMac(booted: string[] = [UDID]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-sim-'));
  const bin = path.join(root, 'bin');
  const home = path.join(root, 'home');
  fs.mkdirSync(bin);
  fs.mkdirSync(home);
  const lines = booted.map((u) => `    iPhone 17 Pro Max (${u}) (Booted)`).join('\\n');
  fs.writeFileSync(
    path.join(bin, 'xcrun'),
    `#!/bin/sh\nprintf '== Devices ==\\n-- iOS 26.2 --\\n${lines}\\n'\n`,
    { mode: 0o755 }
  );
  const lockDir = (udid: string) => path.join(home, '.veloq-locks', `sim-${udid}`);
  const host = (name: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    HOME: home,
    VELOQ_SIM_LOCK_HELD: '',
    VELOQ_SIM_LOCK_WAIT: '0',
    VELOQ_SIM_HOST: name,
    VELOQ_SIM_ITEM: `item-${name}`,
    ...extra,
  });
  return { root, lockDir, host };
}

async function holdWhile(env: NodeJS.ProcessEnv, udid: string, ready: string) {
  const first = spawn(wrapper, [udid, 'sh', '-c', `touch ${ready}; sleep 5`], {
    stdio: 'ignore',
    env,
  });
  for (let i = 0; i < 100 && !fs.existsSync(ready); i++) {
    await new Promise((r) => setTimeout(r, 50));
  }
  return first;
}

describe('the simulator lock', () => {
  it('refuses a second taker on one udid, naming the first owner', async () => {
    const { root, lockDir, host } = fakeMac();
    const first = await holdWhile(host('alpha'), UDID, path.join(root, 'ready'));
    expect(fs.existsSync(lockDir(UDID))).toBe(true);

    const second = spawnSync(wrapper, [UDID, 'sh', '-c', 'echo ran'], {
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

  it('resolves booted to the udid it locks, so booted and the udid exclude each other', async () => {
    const { root, host } = fakeMac();
    const first = await holdWhile(host('alpha'), 'booted', path.join(root, 'ready'));
    const second = spawnSync(wrapper, [UDID, 'echo', 'ran'], {
      encoding: 'utf8',
      env: host('beta'),
      timeout: 10000,
    });
    first.kill();
    expect(second.stdout).not.toContain('ran');
    expect(second.stderr).toContain('item-alpha');
  });

  it('refuses booted when more than one simulator is booted', () => {
    const { host } = fakeMac([UDID, OTHER]);
    const run = spawnSync(wrapper, ['booted', 'echo', 'ran'], {
      encoding: 'utf8',
      env: host('alpha'),
    });
    expect(run.status).not.toBe(0);
    expect(run.stdout).not.toContain('ran');
    expect(run.stderr).toContain(UDID);
    expect(run.stderr).toContain(OTHER);
  });

  it('does not hold one udid against another', async () => {
    const { root, host } = fakeMac([UDID, OTHER]);
    const first = await holdWhile(host('alpha'), UDID, path.join(root, 'ready'));
    const second = spawnSync(wrapper, [OTHER, 'echo', 'ran'], {
      encoding: 'utf8',
      env: host('beta'),
      timeout: 10000,
    });
    first.kill();
    expect(second.status).toBe(0);
    expect(second.stdout).toContain('ran');
  });

  it('runs a nested call under a hold without blocking', () => {
    const { lockDir, host } = fakeMac();
    const run = spawnSync(
      wrapper,
      [UDID, 'sh', '-c', `${wrapper} ${UDID} sh -c 'test -d ${lockDir(UDID)} && echo through'`],
      { encoding: 'utf8', env: host('alpha'), timeout: 10000 }
    );
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('through');
  });

  it('releases on exit, keeping the exit code, so the next taker gets it', () => {
    const { lockDir, host } = fakeMac();
    const failed = spawnSync(wrapper, [UDID, 'sh', '-c', 'exit 7'], { env: host('alpha') });
    expect(failed.status).toBe(7);
    expect(fs.existsSync(lockDir(UDID))).toBe(false);

    const next = spawnSync(wrapper, [UDID, 'echo', 'ran'], {
      encoding: 'utf8',
      env: host('beta'),
    });
    expect(next.status).toBe(0);
    expect(next.stdout).toContain('ran');
  });

  it('takes over a holder older than the stated limit', () => {
    const { lockDir, host } = fakeMac();
    fs.mkdirSync(lockDir(UDID), { recursive: true });
    fs.writeFileSync(
      path.join(lockDir(UDID), 'holder'),
      `host=gone pid=1 item=old since=${nowSeconds() - 99999}\n`
    );
    const run = spawnSync(wrapper, [UDID, 'echo', 'ran'], {
      encoding: 'utf8',
      env: host('beta', { VELOQ_SIM_LOCK_MAX_AGE: '3600' }),
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('ran');
  });

  it('takes over a holder on this host whose process is dead', () => {
    const { lockDir, host } = fakeMac();
    fs.mkdirSync(lockDir(UDID), { recursive: true });
    fs.writeFileSync(
      path.join(lockDir(UDID), 'holder'),
      `host=alpha pid=2147483646 item=old since=${nowSeconds()}\n`
    );
    const run = spawnSync(wrapper, [UDID, 'echo', 'ran'], {
      encoding: 'utf8',
      env: host('alpha'),
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('ran');
  });

  it('refuses a recent holder on another host even when its pid means nothing here', () => {
    const { lockDir, host } = fakeMac();
    fs.mkdirSync(lockDir(UDID), { recursive: true });
    fs.writeFileSync(
      path.join(lockDir(UDID), 'holder'),
      `host=alpha pid=2147483646 item=busy since=${nowSeconds()}\n`
    );
    const run = spawnSync(wrapper, [UDID, 'echo', 'ran'], {
      encoding: 'utf8',
      env: host('beta'),
    });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('busy');
  });
});
