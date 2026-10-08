/**
 * Scenario: Veloq Dev and Veloq are each their own Xcode project, so a
 * DerivedData holds a Release build of both at once, and an iOS build or
 * install that took its identity from the caller's environment built or
 * installed whichever one that happened to name.
 *
 * Expected behaviour: `run-ios.sh` takes the identity and the compile mode as
 * arguments and builds, records and finds the app of that identity, and the
 * app lookup an install uses picks the newest app of the identity asked for.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const root = path.join(__dirname, '../../..');

function executable(file: string, source: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source, { mode: 0o755 });
}

function run(args: string[], { failCheck = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-run-'));
  const bin = path.join(dir, 'bin');
  const log = path.join(dir, 'calls');
  fs.mkdirSync(path.join(dir, 'scripts/lib'), { recursive: true });
  fs.copyFileSync(path.join(root, 'scripts/run-ios.sh'), path.join(dir, 'scripts/run-ios.sh'));
  fs.chmodSync(path.join(dir, 'scripts/run-ios.sh'), 0o755);
  const spy = '#!/bin/sh\necho "APP_VARIANT=${APP_VARIANT:-} $(basename "$0") $*" >> "$TEST_LOG"\n';
  executable(
    path.join(bin, 'node'),
    failCheck ? `${spy}[ "$1" = scripts/check-toolchain.mjs ] && exit 1\nexit 0\n` : spy
  );
  executable(path.join(bin, 'npx'), spy);
  const result = spawnSync(path.join(dir, 'scripts/run-ios.sh'), args, {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
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

  it('builds Dev standalone as a Release build and records it', () => {
    const { result, calls } = run(['dev', 'standalone']);
    expect(result.status).toBe(0);
    expect(calls).toEqual([
      'APP_VARIANT=dev node scripts/check-toolchain.mjs --platform ios',
      'APP_VARIANT=dev node scripts/prepare-native.mjs --platform ios',
      'APP_VARIANT=dev node scripts/build-record.js snapshot ios Release',
      'APP_VARIANT=dev npx expo run:ios --configuration Release',
      'APP_VARIANT=dev node scripts/build-record.js write-ios Release',
    ]);
  });

  it.each([[['production']], [['production', 'standalone']]])(
    'builds production from %j as a Release build and records it',
    (args) => {
      const { result, calls } = run(args);
      expect(result.status).toBe(0);
      expect(calls[0]).toBe(
        'APP_VARIANT=production node scripts/check-toolchain.mjs --platform ios'
      );
      expect(calls.at(-2)).toBe('APP_VARIANT=production npx expo run:ios --configuration Release');
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
        env: { ...process.env, HOME: home, APP_VARIANT: 'production' },
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
    executable(path.join(bin, 'xcrun'), `#!/bin/sh\necho "$*" >> "${home}/xcrun.log"\n`);

    const result = spawnSync(
      path.join(root, 'scripts/install-ios.sh'),
      ['Release', '--identity', 'dev', '--stale'],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
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
      { encoding: 'utf8', env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` } }
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
