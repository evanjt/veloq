/**
 * Scenario: a fresh clone with Node only runs a native build. The tracematch
 * directory is empty and Rust, cargo-ndk and a JDK are absent. Separately, a
 * Mac that builds only iOS has Rust with the Apple targets and Xcode, and none
 * of the Android pieces.
 *
 * Expected behaviour: the check refuses before the build with one line per
 * missing prerequisite of the platform named, names the SSH remote when the
 * submodule cannot be fetched, never asks an iOS build for the Android
 * toolchain, refuses a call that names no platform, and does nothing in CI.
 * A Node major other than the one `.nvmrc` pins is named as a warning that
 * leaves the verdict alone, since CI builds under the pinned major. A shell
 * with no JAVA_HOME on a machine that has a JDK under the system JVM directory
 * builds with that JDK, named, rather than being refused.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gitFreeEnv } from '../__shared__/gitFixture';

const script = path.join(__dirname, '../../../scripts/check-toolchain.mjs');
const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

function freshClone(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolchain-'));
  dirs.push(root);
  spawnSync('git', ['init', '-q'], { cwd: root, env: gitFreeEnv() });
  fs.mkdirSync(path.join(root, 'modules/veloqrs/rust/tracematch'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.gitmodules'),
    '[submodule "modules/veloqrs/rust/tracematch"]\n\tpath = modules/veloqrs/rust/tracematch\n\turl = git@example.invalid:team/tracematch.git\n'
  );
  return root;
}

function executable(file: string, source: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source, { mode: 0o755 });
}

/** A clone with tracematch checked out and Rust on `PATH` with only `targets` installed. */
function rustClone(targets: string[], { xcode = true } = {}): string {
  const root = freshClone();
  fs.writeFileSync(path.join(root, 'modules/veloqrs/rust/tracematch/Cargo.toml'), '');
  const bin = path.join(root, 'bin');
  executable(path.join(bin, 'cargo'), '#!/bin/sh\n[ "$1" = --version ] || exit 1\n');
  executable(
    path.join(bin, 'rustup'),
    `#!/bin/sh\n[ "$1" = --version ] && exit 0\nprintf '%s\\n' ${targets.join(' ')}\n`
  );
  if (xcode) executable(path.join(bin, 'xcodebuild'), '#!/bin/sh\nexit 0\n');
  return root;
}

const APPLE = ['aarch64-apple-ios', 'aarch64-apple-ios-sim'];

function check(
  root: string,
  env: Record<string, string>,
  platform: string[] = ['--platform', 'android']
) {
  // A case describes a machine by the variables it passes, so neither the
  // runner's CI, which stands the check down, nor its JDK may leak in.
  const developer = { ...process.env };
  delete developer.CI;
  delete developer.JAVA_HOME;
  return spawnSync(process.execPath, [script, '--root', root, ...platform], {
    encoding: 'utf8',
    env: {
      ...gitFreeEnv(developer),
      PATH: path.join(root, 'bin'),
      HOME: root,
      VELOQ_JVM_DIR: path.join(root, 'jvm'),
      ...env,
    },
  });
}

/** A JDK named `name` under the clone's own JVM directory, or a directory that only looks like one. */
function jdk(root: string, name: string, { java = true } = {}): string {
  const home = path.join(root, 'jvm', name);
  fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
  if (java) executable(path.join(home, 'bin', 'java'), '#!/bin/sh\nexit 0\n');
  return home;
}

/** A clone with everything an Android build needs except, unless given, a JAVA_HOME. */
function androidClone(): string {
  const root = rustClone(['aarch64-linux-android']);
  executable(path.join(root, 'bin', 'cargo'), '#!/bin/sh\nexit 0\n');
  return root;
}

describe('check-toolchain', () => {
  it('names each missing prerequisite on its own line', () => {
    const result = check(freshClone(), {});
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('tracematch is empty');
    expect(result.stderr).toContain('git@example.invalid:team/tracematch.git');
    expect(result.stderr).toContain('cargo not found');
    expect(result.stderr).toContain('JAVA_HOME is not set');
  });

  it('passes the toolchain lines when only the submodule is missing', () => {
    const result = check(freshClone(), { JAVA_HOME: '/jdk' });
    expect(result.stderr).not.toContain('JAVA_HOME');
  });

  it('does nothing in CI', () => {
    const result = check(freshClone(), { CI: 'true' });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('asks an iOS build for the Apple targets and Xcode, never the Android toolchain', () => {
    const result = check(rustClone(APPLE), {}, ['--platform', 'ios']);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('still asks an Android build for cargo ndk, its target and a JDK on the same machine', () => {
    const result = check(rustClone(APPLE), {}, ['--platform', 'android']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('cargo ndk not found');
    expect(result.stderr).toContain('no Android Rust target installed');
    expect(result.stderr).toContain('JAVA_HOME is not set');
    expect(result.stderr).not.toContain('Apple');
    expect(result.stderr).not.toContain('xcodebuild');
  });

  it.each([[[]], [['aarch64-apple-ios']], [['aarch64-apple-ios-sim']]])(
    'names each Apple target an iOS build lacks, with %j installed',
    (targets) => {
      const result = check(rustClone([...targets, 'aarch64-linux-android']), {}, [
        '--platform',
        'ios',
      ]);
      expect(result.status).toBe(1);
      for (const target of APPLE.filter((t) => !targets.includes(t))) {
        expect(result.stderr).toContain(`target ${target} not installed`);
      }
      for (const target of targets) {
        expect(result.stderr).not.toContain(`target ${target} not installed`);
      }
      expect(result.stderr).not.toContain('cargo ndk');
      expect(result.stderr).not.toContain('JAVA_HOME');
    }
  );

  it('names a missing Xcode for an iOS build', () => {
    const result = check(rustClone(APPLE, { xcode: false }), {}, ['--platform', 'ios']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('xcodebuild not found');
  });

  it('builds with the system JDK when JAVA_HOME is unset, and names it', () => {
    const root = androidClone();
    const home = jdk(root, 'java-17-openjdk');
    jdk(root, 'default');
    const result = check(root, {}, ['--platform', 'android', '--print-java-home']);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(home);
    expect(result.stderr).toContain(`JAVA_HOME is not set; using ${home}`);
  });

  it('falls back to the default JDK when the pinned one is absent', () => {
    const root = androidClone();
    const home = jdk(root, 'default');
    const result = check(root, {}, ['--platform', 'android', '--print-java-home']);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(home);
  });

  it('refuses when the JVM directory holds nothing with a java binary', () => {
    const root = androidClone();
    jdk(root, 'java-17-openjdk', { java: false });
    const result = check(root, {}, ['--platform', 'android', '--print-java-home']);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('JAVA_HOME is not set');
  });

  it('keeps a JAVA_HOME the shell set, and says nothing about it', () => {
    const root = androidClone();
    jdk(root, 'java-17-openjdk');
    const result = check(root, { JAVA_HOME: '/opt/jdk' }, [
      '--platform',
      'android',
      '--print-java-home',
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('/opt/jdk');
    expect(result.stderr).toBe('');
  });

  const runningMajor = Number(process.versions.node.split('.')[0]);

  it.each([['24'], ['v24.3.0\n'], ['lts/*']])(
    'warns when the running Node major differs from an .nvmrc of %j, and still passes',
    (pin) => {
      const root = rustClone(APPLE);
      const pinned = pin.replace(/\d+/, String(runningMajor + 1));
      fs.writeFileSync(path.join(root, '.nvmrc'), pinned);
      const result = check(root, {}, ['--platform', 'ios']);
      expect(result.status).toBe(0);
      if (/\d/.test(pin)) {
        expect(result.stderr).toContain(
          `Node ${process.version} is running, but .nvmrc pins Node ${runningMajor + 1}`
        );
      } else {
        expect(result.stderr).toBe('');
      }
    }
  );

  it('says nothing when the running Node major is the pinned one', () => {
    const root = rustClone(APPLE);
    fs.writeFileSync(path.join(root, '.nvmrc'), `${runningMajor}\n`);
    const result = check(root, {}, ['--platform', 'ios']);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('names a Node mismatch beside the missing prerequisites it refuses', () => {
    const root = freshClone();
    fs.writeFileSync(path.join(root, '.nvmrc'), String(runningMajor + 1));
    const result = check(root, {});
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`.nvmrc pins Node ${runningMajor + 1}`);
    expect(result.stderr).toContain('cargo not found');
  });

  it.each([[[]], [['--platform']], [['--platform', 'windows']]])(
    'refuses %j rather than defaulting to a platform',
    (platform) => {
      const result = check(rustClone(APPLE), {}, platform);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('--platform android|ios');
    }
  );
});
