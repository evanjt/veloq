/**
 * Scenario: Veloq Dev and Veloq are each their own Xcode project, so a
 * DerivedData holds a Release build of both at once, and an iOS build or
 * install that took its identity from the caller's environment built or
 * installed whichever one that happened to name.
 *
 * Expected behaviour: `run-ios.sh` takes the identity and the compile mode as
 * arguments and builds, records and finds the app of that identity, and the
 * app lookup an install uses picks the newest app of the identity asked for.
 * A standalone build only builds: one that also launched would stream the
 * simulator log and never exit, which holds the iOS gate at its build step.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { gitFreeEnv, initFixtureRepo, runGit } from '../__shared__/gitFixture';

const root = path.join(__dirname, '../../..');
const preflight = 'scripts/lib/ios-disk-preflight.sh';

function executable(file: string, source: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source, { mode: 0o755 });
}

/** A checkout holding copies of the production iOS run script and its preflight. */
function checkout(dir: string) {
  fs.mkdirSync(path.join(dir, 'scripts/lib'), { recursive: true });
  for (const script of ['scripts/run-ios.sh', preflight]) {
    if (!fs.existsSync(path.join(root, script))) continue;
    fs.copyFileSync(path.join(root, script), path.join(dir, script));
    fs.chmodSync(path.join(dir, script), 0o755);
  }
}

// Like `expo run:ios`, which ends after the build only when no device is targeted
// and otherwise launches the app and streams its log until it is interrupted.
const expo = `#!/bin/sh
echo "APP_VARIANT=\${APP_VARIANT:-} $(basename "$0") $*" >> "$TEST_LOG"
case " $* " in *" --device generic "*) exit 0 ;; esac
case "$*" in *--configuration*) exec sleep 60 ;; esac
`;

function run(args: string[], { failCheck = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-run-'));
  const bin = path.join(dir, 'bin');
  const log = path.join(dir, 'calls');
  checkout(dir);
  // The identity cases are about arguments, so the disk preflight stays out of them on any host.
  executable(path.join(bin, 'uname'), '#!/bin/sh\necho Linux\n');
  const spy = '#!/bin/sh\necho "APP_VARIANT=${APP_VARIANT:-} $(basename "$0") $*" >> "$TEST_LOG"\n';
  executable(
    path.join(bin, 'node'),
    failCheck ? `${spy}[ "$1" = scripts/check-toolchain.mjs ] && exit 1\nexit 0\n` : spy
  );
  executable(path.join(bin, 'npx'), expo);
  const result = spawnSync(path.join(dir, 'scripts/run-ios.sh'), args, {
    cwd: dir,
    encoding: 'utf8',
    timeout: 15_000,
    killSignal: 'SIGKILL',
    env: {
      ...gitFreeEnv(),
      PATH: `${bin}:${process.env.PATH}`,
      // The caller's own selection, which the arguments override.
      APP_VARIANT: args[0] === 'production' ? 'dev' : 'production',
      TEST_LOG: log,
    },
  });
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];
  fs.rmSync(dir, { recursive: true, force: true });
  return { result, calls };
}

describe('iOS identity and compile mode are separate arguments', () => {
  it('builds Dev against Metro as a Debug build', () => {
    const { result, calls } = run(['dev', 'metro']);
    expect(result.status).toBe(0);
    expect(calls).toEqual([
      'APP_VARIANT=dev node scripts/check-toolchain.mjs --platform ios',
      'APP_VARIANT=dev node scripts/prepare-native.mjs --platform ios',
      'APP_VARIANT=dev node scripts/build-record.js snapshot ios Debug',
      'APP_VARIANT=dev npx expo run:ios',
    ]);
  });

  it('builds Dev standalone as a Release build without launching it, records it and exits', () => {
    const { result, calls } = run(['dev', 'standalone']);
    expect(result.signal).toBeNull();
    expect(result.status).toBe(0);
    expect(calls).toEqual([
      'APP_VARIANT=dev node scripts/check-toolchain.mjs --platform ios',
      'APP_VARIANT=dev node scripts/prepare-native.mjs --platform ios',
      'APP_VARIANT=dev node scripts/build-record.js snapshot ios Release',
      'APP_VARIANT=dev npx expo run:ios --configuration Release --device generic',
      'APP_VARIANT=dev node scripts/build-record.js write-ios Release',
    ]);
  });

  it.each([[['production']], [['production', 'standalone']]])(
    'builds production from %j as a Release build and records it',
    (args) => {
      const { result, calls } = run(args);
      expect(result.signal).toBeNull();
      expect(result.status).toBe(0);
      expect(calls[0]).toBe(
        'APP_VARIANT=production node scripts/check-toolchain.mjs --platform ios'
      );
      expect(calls.at(-2)).toBe(
        'APP_VARIANT=production npx expo run:ios --configuration Release --device generic'
      );
      expect(calls.at(-1)).toBe(
        'APP_VARIANT=production node scripts/build-record.js write-ios Release'
      );
    }
  );

  it.each([[['dev', 'metro']], [['dev', 'standalone']], [['production']]])(
    'stops %j before generating when the toolchain check refuses',
    (args) => {
      const { result, calls } = run(args, { failCheck: true });
      expect(result.status).toBe(1);
      expect(calls).toEqual([
        `APP_VARIANT=${args[0]} node scripts/check-toolchain.mjs --platform ios`,
      ]);
    }
  );

  it.each([[['production', 'metro']], [['dev']], [['Release']], [[]]])(
    'refuses %j before building',
    (args) => {
      const { result, calls } = run(args);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('usage');
      expect(calls).toEqual([]);
    }
  );
});

describe('the iOS app an install finds', () => {
  let home: string;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-home-'));
  });
  afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

  function app(project: string, name: string, bundleId: string, age: number) {
    const dir = path.join(
      home,
      'Library/Developer/Xcode/DerivedData',
      project,
      'Build/Products/Release-iphonesimulator',
      `${name}.app`
    );
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'Info.plist'),
      `<plist><dict><key>CFBundleIdentifier</key><string>${bundleId}</string></dict></plist>`
    );
    const time = new Date(Date.now() - age * 1000);
    fs.utimesSync(dir, time, time);
    return dir;
  }

  const locate = (...args: string[]) =>
    spawnSync(
      process.execPath,
      [path.join(root, 'scripts/build-record.js'), 'locate-ios', ...args],
      {
        encoding: 'utf8',
        env: { ...gitFreeEnv(), HOME: home, APP_VARIANT: 'production' },
      }
    );

  it('finds the newest app of the identity asked for, though the other is newer', () => {
    const dev = app('VeloqDev-orchard', 'VeloqDev', 'com.veloq.app.dev', 60);
    const production = app('Veloq-orchard', 'Veloq', 'com.veloq.app', 10);

    expect(locate('Release', '--identity', 'dev').stdout.trim()).toBe(dev);
    expect(locate('Release', '--identity', 'production').stdout.trim()).toBe(production);
    expect(locate('Release').stdout.trim()).toBe(production);
  });

  it('installs the app of the identity asked for, whatever APP_VARIANT holds', () => {
    const dev = app('VeloqDev-orchard', 'VeloqDev', 'com.veloq.app.dev', 60);
    app('Veloq-orchard', 'Veloq', 'com.veloq.app', 10);
    const bin = path.join(home, 'bin');
    // The simulator lock resolves `booted` through `simctl list`, which drives nothing.
    executable(
      path.join(bin, 'xcrun'),
      [
        '#!/bin/sh',
        'if [ "$1 $2" = "simctl list" ]; then',
        "  echo '    iPhone 17 (00000000-AAAA-BBBB-CCCC-111111111111) (Booted)'",
        '  exit 0',
        'fi',
        `echo "$*" >> "${home}/xcrun.log"`,
      ].join('\n')
    );

    const result = spawnSync(
      path.join(root, 'scripts/install-ios.sh'),
      ['Release', '--identity', 'dev', '--stale'],
      {
        encoding: 'utf8',
        env: {
          ...gitFreeEnv(),
          HOME: home,
          APP_VARIANT: 'production',
          PATH: `${bin}:${process.env.PATH}`,
        },
      }
    );

    expect(result.status).toBe(0);
    expect(fs.readFileSync(path.join(home, 'xcrun.log'), 'utf8').trim()).toBe(
      `simctl install booted ${dev}`
    );
  });

  it('refuses an identity it does not know, even under --stale', () => {
    app('Veloq-orchard', 'Veloq', 'com.veloq.app', 10);
    const bin = path.join(home, 'bin');
    executable(path.join(bin, 'xcrun'), `#!/bin/sh\necho "$*" >> "${home}/xcrun.log"\n`);

    const result = spawnSync(
      path.join(root, 'scripts/install-ios.sh'),
      ['Release', '--identity', 'staging', '--stale'],
      { encoding: 'utf8', env: { ...gitFreeEnv(), HOME: home, PATH: `${bin}:${process.env.PATH}` } }
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--identity staging names no identity');
    expect(fs.existsSync(path.join(home, 'xcrun.log'))).toBe(false);
  });

  it('names the identity when no app of it was built', () => {
    app('Veloq-orchard', 'Veloq', 'com.veloq.app', 10);

    const result = locate('Release', '--identity', 'dev');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no Release .app of com.veloq.app.dev');
  });
});

describe('the iOS build refuses a disk too full to finish it', () => {
  const GIB_KIB = 1024 * 1024;
  let base: string;
  beforeEach(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ios-disk-')));
  });
  afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

  /** A tree under `home` holding `kib` KiB of real bytes. */
  function tree(relative: string, kib: number) {
    const dir = path.join(base, 'home', relative);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'blob'), Buffer.alloc(kib * 1024, 1));
    return dir;
  }

  function build(
    {
      system = 'Darwin',
      freeKib,
      env = {},
      withDf = true,
    }: { system?: string; freeKib: number; env?: Record<string, string>; withDf?: boolean },
    dir = path.join(base, 'checkout')
  ) {
    const bin = path.join(base, 'bin');
    const log = path.join(base, 'calls');
    fs.mkdirSync(path.join(base, 'home'), { recursive: true });
    checkout(dir);
    executable(path.join(bin, 'uname'), `#!/bin/sh\necho ${system}\n`);
    if (withDf) {
      executable(
        path.join(bin, 'df'),
        [
          '#!/bin/sh',
          'echo "df $*" >> "$TEST_LOG"',
          'echo "Filesystem 1024-blocks Used Available Capacity Mounted on"',
          `echo "/dev/disk3s1 494384795 480000000 ${freeKib} 97% /"`,
          '',
        ].join('\n')
      );
    }
    executable(path.join(bin, 'node'), '#!/bin/sh\necho "$(basename "$0") $*" >> "$TEST_LOG"\n');
    executable(path.join(bin, 'npx'), '#!/bin/sh\necho "$(basename "$0") $*" >> "$TEST_LOG"\n');
    // Without df on PATH the preflight has nothing to read, and the system tools stay reachable.
    const systemPath = withDf ? `${bin}:${process.env.PATH}` : `${bin}:${noDfPath(bin)}`;
    const result = spawnSync(path.join(dir, 'scripts/run-ios.sh'), ['dev', 'standalone'], {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...gitFreeEnv(),
        HOME: path.join(base, 'home'),
        PATH: systemPath,
        TEST_LOG: log,
        ...env,
      },
    });
    const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];
    return { result, calls };
  }

  /** A PATH of links to every tool the preflight uses except df. */
  function noDfPath(bin: string) {
    const tools = path.join(base, 'tools');
    fs.mkdirSync(tools, { recursive: true });
    for (const tool of ['sh', 'dirname', 'basename', 'git', 'du', 'sort', 'head', 'awk', 'cat']) {
      const found = spawnSync('sh', ['-c', `command -v ${tool}`], {
        encoding: 'utf8',
        env: gitFreeEnv(),
      }).stdout.trim();
      if (found && !fs.existsSync(path.join(bin, tool)))
        fs.symlinkSync(found, path.join(tools, tool));
    }
    return tools;
  }

  it('stops before any build step under 20 GiB and names the scratch trees, largest first', () => {
    tree('tmp-old-build', 64);
    tree('projects/old-build', 256);

    const { result, calls } = build({ freeKib: 8 * GIB_KIB });

    expect(result.status).toBe(1);
    expect(calls.filter((call) => !call.startsWith('df '))).toEqual([]);
    expect(result.stderr).toContain('8.0 GiB free');
    expect(result.stderr).toContain('20 GiB');
    const projects = result.stderr.indexOf(path.join(base, 'home/projects/old-build'));
    const tmp = result.stderr.indexOf(path.join(base, 'home/tmp-old-build'));
    expect(projects).toBeGreaterThan(-1);
    expect(tmp).toBeGreaterThan(projects);
    expect(fs.existsSync(path.join(base, 'home/tmp-old-build/blob'))).toBe(true);
    expect(fs.existsSync(path.join(base, 'home/projects/old-build/blob'))).toBe(true);
  });

  it('names at most five trees', () => {
    for (let index = 1; index <= 7; index++) tree(`tmp-scratch${index}-build`, index * 8);

    const { result } = build({ freeKib: 8 * GIB_KIB });

    expect(result.status).toBe(1);
    const named = result.stderr.split('\n').filter((line) => line.includes('-build'));
    expect(named).toHaveLength(5);
    expect(named[0]).toContain('tmp-scratch7-build');
    expect(result.stderr).not.toContain('tmp-scratch2-build');
  });

  it('names the other worktrees of the checkout and not the one building', () => {
    const dir = path.join(base, 'checkout');
    fs.mkdirSync(dir, { recursive: true });
    initFixtureRepo(dir);
    runGit(['commit', '-q', '--allow-empty', '-m', 'start'], dir);
    const other = path.join(base, 'elsewhere', 'orchard-tree');
    runGit(['worktree', 'add', '-q', other], dir);

    const { result } = build({ freeKib: 8 * GIB_KIB }, dir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(other);
    expect(result.stderr).not.toMatch(new RegExp(`${dir}\\s*$`, 'm'));
  });

  it('never names the main checkout when a linked worktree builds', () => {
    const main = path.join(base, 'checkout');
    fs.mkdirSync(main, { recursive: true });
    initFixtureRepo(main);
    runGit(['commit', '-q', '--allow-empty', '-m', 'start'], main);
    const linked = path.join(base, 'elsewhere', 'orchard-tree');
    runGit(['worktree', 'add', '-q', linked], main);
    const sibling = path.join(base, 'elsewhere', 'meadow-tree');
    runGit(['worktree', 'add', '-q', sibling], main);

    const { result } = build({ freeKib: 8 * GIB_KIB }, linked);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(sibling);
    expect(result.stderr).not.toContain(main + '\n');
    expect(result.stderr).not.toContain(linked + '\n');
  });

  it('builds with 40 GiB free', () => {
    tree('tmp-old-build', 64);

    const { result, calls } = build({ freeKib: 40 * GIB_KIB });

    expect(result.status).toBe(0);
    expect(calls[0]).toMatch(/^df -Pk /);
    expect(calls.at(-1)).toBe('node scripts/build-record.js write-ios Release');
  });

  it('refuses at one KiB under the threshold and builds at it', () => {
    expect(build({ freeKib: 20 * GIB_KIB - 1 }).result.status).toBe(1);
    expect(build({ freeKib: 20 * GIB_KIB }).result.status).toBe(0);
  });

  it('takes a deliberate lower threshold from the environment', () => {
    const { result } = build({ freeKib: 8 * GIB_KIB, env: { VELOQ_IOS_MIN_FREE_GIB: '5' } });

    expect(result.status).toBe(0);
  });

  it('refuses a threshold that is not a whole number of GiB', () => {
    const { result, calls } = build({
      freeKib: 40 * GIB_KIB,
      env: { VELOQ_IOS_MIN_FREE_GIB: 'lots' },
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('VELOQ_IOS_MIN_FREE_GIB');
    expect(calls.filter((call) => !call.startsWith('df '))).toEqual([]);
  });

  it('never reads the disk on Linux', () => {
    const { result, calls } = build({ system: 'Linux', freeKib: 1 });

    expect(result.status).toBe(0);
    expect(calls.some((call) => call.startsWith('df '))).toBe(false);
  });

  it('skips the check on a Mac with no df', () => {
    const { result } = build({ freeKib: 1, withDf: false });

    expect(result.status).toBe(0);
  });
});
