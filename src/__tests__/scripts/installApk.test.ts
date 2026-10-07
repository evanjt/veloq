/**
 * Scenario: an APK outlives its checkout. One cut at 13:14 was installed at
 * 21:36, a merge later, and ran without the fix it had been installed to test.
 *
 * Expected behaviour: `install-apk.sh` installs only an APK whose build record
 * matches what the APK packages, the tree it is run from, and the identity,
 * Rust selection and handset asked for, unless `--stale` says the mismatch is
 * known. An install keeps the app's data, and a refusal reaches no handset
 * beyond asking which ABIs it runs.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { APK, build, checkout, write } from '../__shared__/apkFixture';
import { gitFreeEnv } from '../__shared__/gitFixture';

const record = require('../../../scripts/lib/build-record.js');

const SCRIPTS = [
  'scripts/install-apk.sh',
  'scripts/build-record.js',
  'scripts/lib/build-record.js',
  'scripts/lib/build-record-ios.js',
  'scripts/lib/build-stamp.js',
  'scripts/compute-source-hash.js',
  'scripts/lint-android-bundle.mjs',
  'modules/veloqrs/scripts/rust-inputs.js',
];

function fixture(): string {
  const root = checkout(SCRIPTS);
  fs.chmodSync(path.join(root, 'scripts/install-apk.sh'), 0o755);
  return root;
}

function install(
  root: string,
  args: string[] = [],
  abis = 'arm64-v8a,armeabi-v7a',
  target = 'debug',
  cwd?: string
) {
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(
    path.join(bin, 'adb'),
    `#!/bin/sh\necho "$*" >> "${root}/adb.log"\n[ "$1" = shell ] && echo "${abis}"\nexit 0\n`,
    { mode: 0o755 }
  );
  const run = spawnSync(path.join(root, 'scripts/install-apk.sh'), [target, ...args], {
    encoding: 'utf8',
    cwd,
    env: {
      ...gitFreeEnv(),
      PATH: `${bin}:${process.env.PATH}`,
      // The handset lock is the caller's, as under `device-lock-shell.sh`.
      VELOQ_DEVICE_LOCK_HELD: '1',
    },
  });
  const log = path.join(root, 'adb.log');
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];
  return {
    status: run.status,
    stdout: run.stdout,
    stderr: run.stderr,
    installs: calls.filter((call) => !call.startsWith('shell getprop')),
  };
}

describe('install-apk.sh', () => {
  let root: string;
  beforeEach(() => {
    root = fixture();
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('installs the recorded build of the tree, keeping the app data', () => {
    record.writeRecord(root, build(root), { variant: 'debug' });

    const result = install(root);

    expect(result.status).toBe(0);
    expect(result.installs).toEqual([`install -r ${APK}`]);
    expect(result.stdout).toMatch(/com\.veloq\.app\.dev debug, Rust release arm64-v8a/);
  });

  it('refuses a build whose dirty source changed since, and reaches no handset', () => {
    write(root, 'src/app.ts', 'export const greeting = "edited";\n');
    record.writeRecord(root, build(root), { variant: 'debug' });
    write(root, 'src/app.ts', 'export const greeting = "edited again";\n');

    const result = install(root);

    expect(result.status).toBe(1);
    expect(result.installs).toEqual([]);
    expect(result.stderr).toContain('--stale');
  });

  it('installs an unverified build once when --stale is passed', () => {
    record.writeRecord(root, build(root), { variant: 'debug' });
    write(root, 'src/app.ts', 'export const greeting = "edited";\n');

    const result = install(root, ['--stale']);

    expect(result.status).toBe(0);
    expect(result.installs).toEqual([`install -r ${APK}`]);
  });

  it('refuses an APK with no build record', () => {
    build(root);

    const result = install(root);

    expect(result.status).toBe(1);
    expect(result.installs).toEqual([]);
    expect(result.stderr).toContain('no build record');
  });

  it('refuses a build with no library the handset can load', () => {
    record.writeRecord(root, build(root, { abis: ['x86_64'] }), { variant: 'debug' });

    const result = install(root);

    expect(result.status).toBe(1);
    expect(result.installs).toEqual([]);
    expect(result.stderr).toContain('the handset runs arm64-v8a, armeabi-v7a');
  });

  it('installs a build with the features it is asked for, and refuses it without them', () => {
    record.writeRecord(root, build(root, { features: ['lock-trace'] }), { variant: 'debug' });

    expect(install(root).status).toBe(1);
    const result = install(root, ['--features', 'lock-trace']);
    expect(result.status).toBe(0);
    expect(result.installs).toEqual([`install -r ${APK}`]);
  });

  it('refuses a stub bundle even when its record matches, and reaches no handset', () => {
    write(
      root,
      'src/i18n/locales/en-AU.json',
      JSON.stringify({
        a: 'A phrase long enough to identify the app bundle',
        b: 'Another phrase the app ships in its locale file',
        c: 'A third phrase that a stub bundle cannot contain',
      })
    );
    record.writeRecord(root, build(root, { bundle: 'var __BUNDLE_START_TIME__;' }), {
      variant: 'debug',
    });

    const result = install(root);

    expect(result.status).toBe(1);
    expect(result.installs).toEqual([]);
    expect(result.stderr).toContain('does not carry the app');
  });

  describe('a named APK file', () => {
    function named(): string {
      const dir = path.join(root, 'old');
      fs.mkdirSync(dir);
      const file = path.join(dir, 'before.apk');
      fs.copyFileSync(path.join(root, APK), file);
      fs.copyFileSync(`${path.join(root, APK)}.build.json`, `${file}.build.json`);
      return file;
    }

    it('installs it when it is the build of the tree, reading a relative path from where the caller stood', () => {
      record.writeRecord(root, build(root), { variant: 'debug' });
      named();

      const result = install(root, [], undefined, 'before.apk', path.join(root, 'old'));

      expect(result.status).toBe(0);
      expect(result.installs).toEqual([`install -r ${path.join(root, 'old/before.apk')}`]);
    });

    it('refuses one cut from other inputs, prints its stamp beside the tree, and reaches no handset', () => {
      record.writeRecord(root, build(root), { variant: 'debug' });
      const file = named();
      write(root, 'src/app.ts', 'export const greeting = "later";\n');

      const result = install(root, [], undefined, file);

      expect(result.status).toBe(1);
      expect(result.installs).toEqual([]);
      expect(result.stdout).toMatch(/stamped .*, the tree is /);
      expect(result.stderr).toContain('--stale');
    });

    it('installs a stale one under --stale', () => {
      record.writeRecord(root, build(root), { variant: 'debug' });
      const file = named();
      write(root, 'src/app.ts', 'export const greeting = "later";\n');

      const result = install(root, ['--stale'], undefined, file);

      expect(result.status).toBe(0);
      expect(result.installs).toEqual([`install -r ${file}`]);
      expect(result.stdout).toMatch(/stamped .*, the tree is /);
    });

    it('refuses a missing file naming the path', () => {
      const result = install(root, [], undefined, path.join(root, 'nope.apk'));

      expect(result.status).toBe(1);
      expect(result.installs).toEqual([]);
      expect(result.stderr).toContain('nope.apk');
    });
  });

  it('refuses an unknown argument before anything else', () => {
    record.writeRecord(root, build(root), { variant: 'debug' });

    const result = install(root, ['--force']);

    expect(result.status).toBe(2);
    expect(result.installs).toEqual([]);
  });
});
