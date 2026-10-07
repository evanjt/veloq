/**
 * Scenario: a worktree made for gates links its `node_modules` into another
 * checkout, whole or one entry at a time. A native build there compiles that
 * checkout's engine module, writes into its packages' build directories, and
 * ships an app that launches and runs code the branch never had.
 *
 * Expected behaviour: every native build command refuses such a tree before
 * it starts, names what resolves outside the checkout and the setup command
 * that gives the tree an installation of its own, and lets a self-contained
 * tree through.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { gitFreeEnv, runGit } from '../__shared__/gitFixture';

const projectRoot = path.join(__dirname, '../../..');
const script = path.join(projectRoot, 'scripts/check-native-tree.mjs');

const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

/** A checkout with its own engine module and router app root, and no install. */
function checkout(parent: string, name: string): string {
  const root = path.join(parent, name);
  fs.mkdirSync(path.join(root, 'modules', 'veloqrs'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src', 'app'), { recursive: true });
  return root;
}

/** A real installation of `packages` under `root`, with `veloqrs` linked to its module. */
function install(root: string, packages: string[]): void {
  for (const name of packages) {
    fs.mkdirSync(path.join(root, 'node_modules', name), { recursive: true });
  }
  fs.symlinkSync(path.join(root, 'modules', 'veloqrs'), path.join(root, 'node_modules', 'veloqrs'));
}

/** Two checkouts side by side, the first fully installed. */
function pair() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-native-tree-'));
  dirs.push(parent);
  const main = checkout(parent, 'main');
  install(main, ['react', 'react-native-reanimated', '@expo/cli']);
  const tree = checkout(parent, 'tree');
  return { main, tree };
}

function check(root: string) {
  return spawnSync(process.execPath, [script, '--root', root], {
    encoding: 'utf8',
    env: gitFreeEnv(),
  });
}

describe('the native build tree check', () => {
  it('lets a tree with its own installation and module through', () => {
    const { main } = pair();

    const result = check(main);

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('refuses a node_modules that is a link to another checkout', () => {
    const { main, tree } = pair();
    fs.symlinkSync(path.join(main, 'node_modules'), path.join(tree, 'node_modules'));

    const result = check(tree);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(fs.realpathSync(path.join(main, 'node_modules')));
    expect(result.stderr).toContain('npm run setup:native');
  });

  it('refuses a package linked into another checkout, where its native outputs are shared', () => {
    const { main, tree } = pair();
    install(tree, ['react', '@expo/cli']);
    fs.symlinkSync(
      path.join(main, 'node_modules', 'react-native-reanimated'),
      path.join(tree, 'node_modules', 'react-native-reanimated')
    );

    const result = check(tree);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('react-native-reanimated');
    expect(result.stderr).toContain('npm run setup:native');
  });

  it('refuses a scoped package linked into another checkout', () => {
    const { main, tree } = pair();
    install(tree, ['react', 'react-native-reanimated']);
    fs.mkdirSync(path.join(tree, 'node_modules', '@expo'));
    fs.symlinkSync(
      path.join(main, 'node_modules', '@expo', 'cli'),
      path.join(tree, 'node_modules', '@expo', 'cli')
    );

    const result = check(tree);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('@expo/cli');
  });

  it('refuses an engine module that resolves to another checkout', () => {
    const { main, tree } = pair();
    install(tree, ['react']);
    fs.rmSync(path.join(tree, 'node_modules', 'veloqrs'));
    fs.symlinkSync(
      path.join(main, 'modules', 'veloqrs'),
      path.join(tree, 'node_modules', 'veloqrs')
    );

    const result = check(tree);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('veloqrs');
    expect(result.stderr).toContain(fs.realpathSync(path.join(main, 'modules', 'veloqrs')));
  });

  it('refuses a source module linked to another checkout even when the installed engine agrees', () => {
    const { main, tree } = pair();
    install(tree, ['react']);
    fs.rmSync(path.join(tree, 'node_modules', 'veloqrs'));
    fs.rmSync(path.join(tree, 'modules', 'veloqrs'), { recursive: true });
    fs.symlinkSync(path.join(main, 'modules', 'veloqrs'), path.join(tree, 'modules', 'veloqrs'));
    fs.symlinkSync(
      path.join('..', 'modules', 'veloqrs'),
      path.join(tree, 'node_modules', 'veloqrs')
    );

    const result = check(tree);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('veloqrs');
    expect(result.stderr).toContain(fs.realpathSync(path.join(main, 'modules', 'veloqrs')));
    expect(result.stderr).toContain('npm run setup:native');
  });

  it('refuses an engine module that is a copy rather than this checkout’s own', () => {
    const { tree } = pair();
    install(tree, ['react']);
    fs.rmSync(path.join(tree, 'node_modules', 'veloqrs'));
    fs.mkdirSync(path.join(tree, 'node_modules', 'veloqrs'));

    const result = check(tree);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('veloqrs');
  });

  it('refuses a tree with no installation at all', () => {
    const { tree } = pair();

    const result = check(tree);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('npm run setup:native');
  });

  it('refuses a router app root that resolves to another checkout', () => {
    const { main, tree } = pair();
    install(tree, ['react']);
    fs.rmSync(path.join(tree, 'src', 'app'), { recursive: true });
    fs.symlinkSync(path.join(main, 'src', 'app'), path.join(tree, 'src', 'app'));

    const result = check(tree);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(path.join('src', 'app'));
  });

  it('runs before every command that builds the app natively', () => {
    const builds = /with-android-build-lock|expo run:|clean:rust/;
    for (const name of [
      'android',
      'android:prod',
      'android:debug',
      'test:android',
      'ios',
      'ios:prod',
    ]) {
      const script = packageJson.scripts[name];
      const check = script.indexOf('node scripts/check-native-tree.mjs && ');

      expect(check).toBeGreaterThanOrEqual(0);
      expect(check).toBeLessThan(script.search(builds));
    }
  });
});

describe('the engine submodule pin check', () => {
  const git = (cwd: string, ...args: string[]) =>
    runGit(['-c', 'protocol.file.allow=always', ...args], cwd);

  /** A superproject pinning a submodule at its second commit, with the submodule checked out at `at`. */
  function pinned(at: 'pin' | 'first') {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-pin-'));
    dirs.push(parent);
    const upstream = path.join(parent, 'upstream');
    fs.mkdirSync(upstream);
    git(upstream, 'init', '-q');
    fs.writeFileSync(path.join(upstream, 'a'), '1');
    git(upstream, 'add', 'a');
    git(upstream, 'commit', '-qm', 'one');
    const first = git(upstream, 'rev-parse', 'HEAD').trim();
    fs.writeFileSync(path.join(upstream, 'a'), '2');
    git(upstream, 'commit', '-qam', 'two');
    const root = checkout(parent, 'super');
    git(root, 'init', '-q');
    git(root, 'submodule', 'add', '-q', upstream, 'modules/veloqrs/rust/tracematch');
    git(root, 'commit', '-qm', 'pin');
    if (at === 'first')
      git(path.join(root, 'modules/veloqrs/rust/tracematch'), 'checkout', '-q', first);
    install(root, ['react']);
    return root;
  }

  it('lets a submodule checked out at the pin through', () => {
    expect(check(pinned('pin')).status).toBe(0);
  });

  it('refuses a submodule checked out behind the pin and names both commits', () => {
    const root = pinned('first');
    const result = check(root);
    const pin = git(root, 'ls-tree', 'HEAD', 'modules/veloqrs/rust/tracematch').split(/\s+/)[2];

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(pin);
    expect(result.stderr).toContain('submodule update');
  });

  it('passes a tree whose submodule was never initialised', () => {
    const root = pinned('pin');
    fs.rmSync(path.join(root, 'modules/veloqrs/rust/tracematch'), { recursive: true });
    fs.mkdirSync(path.join(root, 'modules/veloqrs/rust/tracematch'));

    expect(check(root).status).toBe(0);
  });
});
