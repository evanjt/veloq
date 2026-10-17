/**
 * Scenario: a worktree made for gates links its `node_modules` into the main
 * checkout, whole or one entry at a time, and is now wanted for a native
 * build. `npm ci` clears `node_modules` before installing, and through a link
 * that clears the installation every other checkout builds and tests against.
 *
 * Expected behaviour: setup removes the links themselves, leaves what they
 * pointed at untouched, installs from the lockfile into the worktree, and
 * passes only when the result is a tree the native builds accept. In the main
 * checkout, whose installation is the shared one, it refuses. It says the
 * tree can build natively only once the build's other inputs are there: the
 * untracked Firebase config is copied from the main checkout and named, and
 * the platform's toolchain passes, so the first build is not where either
 * turns out to be missing.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { gitFreeEnv, runGit } from '../__shared__/gitFixture';

const projectRoot = path.join(__dirname, '../../..');
const script = path.join(projectRoot, 'scripts/setup-native-worktree.mjs');

const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * A stand-in for npm that records its arguments and installs what a lockfile
 * install of this project leaves: a package, and `veloqrs` linked to the
 * checkout's own module.
 */
function fakeNpm(dir: string, installs: 'own' | 'elsewhere' = 'own'): string {
  const npm = path.join(dir, 'npm');
  const target = installs === 'own' ? '"$PWD/modules/veloqrs"' : `"${dir}"`;
  fs.writeFileSync(
    npm,
    [
      '#!/bin/sh',
      `printf '%s\\n' "$*" >> "${path.join(dir, 'npm.log')}"`,
      'mkdir -p node_modules/react',
      `ln -s ${target} node_modules/veloqrs`,
      '',
    ].join('\n'),
    { mode: 0o755 }
  );
  return npm;
}

/** A main checkout with an installation, and a worktree of it with none. */
function trees() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-setup-native-'));
  dirs.push(parent);
  const main = path.join(parent, 'main');
  fs.mkdirSync(path.join(main, 'modules', 'veloqrs'), { recursive: true });
  fs.mkdirSync(path.join(main, 'src', 'app'), { recursive: true });
  fs.writeFileSync(path.join(main, 'modules', 'veloqrs', 'index.ts'), '');
  fs.writeFileSync(path.join(main, 'src', 'app', 'index.tsx'), '');
  fs.mkdirSync(path.join(main, 'modules', 'veloqrs', 'rust', 'tracematch'), { recursive: true });
  fs.writeFileSync(path.join(main, 'modules', 'veloqrs', 'rust', 'tracematch', 'Cargo.toml'), '');
  runGit(['init', '-q'], main);
  runGit(['add', '.'], main);
  runGit(['commit', '-qm', 'Fixture'], main);
  fs.mkdirSync(path.join(main, 'node_modules', 'react'), { recursive: true });
  fs.writeFileSync(path.join(main, 'node_modules', 'react', 'package.json'), '{}');
  fs.symlinkSync(path.join(main, 'modules', 'veloqrs'), path.join(main, 'node_modules', 'veloqrs'));
  fs.writeFileSync(path.join(main, FIREBASE), MAIN_CONFIG);
  const tree = path.join(parent, 'tree');
  runGit(['worktree', 'add', '-q', '--detach', tree], main);
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-setup-native-npm-'));
  dirs.push(bin);
  androidToolchain(bin);
  return { main, tree, bin };
}

const FIREBASE = 'google-services.json';
const MAIN_CONFIG = '{"project_info":{"project_id":"lantern-fixture"}}\n';

function executable(file: string, source: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source, { mode: 0o755 });
}

/** Rust with cargo-ndk and an Android target, and a JDK under `bin`'s own JVM directory. */
function androidToolchain(bin: string) {
  executable(path.join(bin, 'cargo'), '#!/bin/sh\nexit 0\n');
  executable(
    path.join(bin, 'rustup'),
    `#!/bin/sh\n[ "$1" = --version ] && exit 0\necho aarch64-linux-android\n`
  );
  executable(path.join(bin, 'jvm', 'java-17-openjdk', 'bin', 'java'), '#!/bin/sh\nexit 0\n');
}

function setup(root: string, npm: string, env: Record<string, string> = {}) {
  // The machine is the fixture's: neither the runner's CI, which stands the
  // toolchain check down, nor its JDK may leak in.
  const developer = { ...process.env };
  delete developer.CI;
  delete developer.JAVA_HOME;
  const bin = path.dirname(npm);
  return spawnSync(process.execPath, [script, '--root', root, '--platform', 'android'], {
    encoding: 'utf8',
    env: {
      ...gitFreeEnv(developer),
      PATH: `${bin}:/usr/bin:/bin`,
      VELOQ_JVM_DIR: path.join(bin, 'jvm'),
      VELOQ_NPM: npm,
      ...env,
    },
  });
}

describe('native worktree setup', () => {
  it('replaces a whole-directory link with an installation of its own and leaves the target alone', () => {
    const { main, tree, bin } = trees();
    fs.symlinkSync(path.join(main, 'node_modules'), path.join(tree, 'node_modules'));

    const result = setup(tree, fakeNpm(bin));

    expect(result.status).toBe(0);
    expect(fs.readFileSync(path.join(bin, 'npm.log'), 'utf8').trim()).toBe('ci');
    expect(fs.lstatSync(path.join(tree, 'node_modules')).isSymbolicLink()).toBe(false);
    expect(fs.realpathSync(path.join(tree, 'node_modules', 'veloqrs'))).toBe(
      fs.realpathSync(path.join(tree, 'modules', 'veloqrs'))
    );
    expect(fs.existsSync(path.join(main, 'node_modules', 'react', 'package.json'))).toBe(true);
    expect(fs.realpathSync(path.join(main, 'node_modules', 'veloqrs'))).toBe(
      fs.realpathSync(path.join(main, 'modules', 'veloqrs'))
    );
  });

  it('replaces per-entry links and leaves every target alone', () => {
    const { main, tree, bin } = trees();
    fs.mkdirSync(path.join(tree, 'node_modules'));
    fs.symlinkSync(
      path.join(main, 'node_modules', 'react'),
      path.join(tree, 'node_modules', 'react')
    );
    fs.symlinkSync(
      path.join(tree, 'modules', 'veloqrs'),
      path.join(tree, 'node_modules', 'veloqrs')
    );

    const result = setup(tree, fakeNpm(bin));

    expect(result.status).toBe(0);
    expect(fs.lstatSync(path.join(tree, 'node_modules', 'react')).isSymbolicLink()).toBe(false);
    expect(fs.existsSync(path.join(main, 'node_modules', 'react', 'package.json'))).toBe(true);
  });

  it('fails when the installation it made is not one the native builds accept', () => {
    const { tree, bin } = trees();

    const result = setup(tree, fakeNpm(bin, 'elsewhere'));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('veloqrs');
  });

  it('copies the Firebase config from the main checkout when the worktree has none, and names it', () => {
    const { tree, bin } = trees();

    const result = setup(tree, fakeNpm(bin));

    expect(result.status).toBe(0);
    expect(fs.readFileSync(path.join(tree, FIREBASE), 'utf8')).toBe(MAIN_CONFIG);
    expect(result.stdout).toContain(`copied ${FIREBASE}`);
    expect(result.stdout).toContain('can build natively');
  });

  it('keeps a Firebase config the worktree already has', () => {
    const { tree, bin } = trees();
    fs.writeFileSync(path.join(tree, FIREBASE), '{"own":true}\n');

    const result = setup(tree, fakeNpm(bin));

    expect(result.status).toBe(0);
    expect(fs.readFileSync(path.join(tree, FIREBASE), 'utf8')).toBe('{"own":true}\n');
    expect(result.stdout).not.toContain(`copied ${FIREBASE}`);
  });

  it('names the Firebase config when neither tree has one, and does not call the tree ready', () => {
    const { main, tree, bin } = trees();
    fs.rmSync(path.join(main, FIREBASE));

    const result = setup(tree, fakeNpm(bin));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(FIREBASE);
    expect(result.stdout).not.toContain('can build natively');
  });

  it('names a toolchain gap rather than calling the tree ready', () => {
    const { tree, bin } = trees();
    fs.rmSync(path.join(bin, 'jvm'), { recursive: true });

    const result = setup(tree, fakeNpm(bin));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('JAVA_HOME is not set');
    expect(result.stdout).not.toContain('can build natively');
  });

  it('names the JDK it found when the shell set no JAVA_HOME', () => {
    const { tree, bin } = trees();

    const result = setup(tree, fakeNpm(bin));

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(path.join(bin, 'jvm', 'java-17-openjdk'));
  });

  it('refuses in the main checkout, whose installation every worktree may share', () => {
    const { main, bin } = trees();

    const result = setup(main, fakeNpm(bin));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('main checkout');
    expect(fs.existsSync(path.join(bin, 'npm.log'))).toBe(false);
    expect(fs.existsSync(path.join(main, 'node_modules', 'react', 'package.json'))).toBe(true);
  });
});
