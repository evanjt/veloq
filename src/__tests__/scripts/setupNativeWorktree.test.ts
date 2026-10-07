/**
 * Scenario: a worktree made for gates links its `node_modules` into the main
 * checkout, whole or one entry at a time, and is now wanted for a native
 * build. `npm ci` clears `node_modules` before installing, and through a link
 * that clears the installation every other checkout builds and tests against.
 *
 * Expected behaviour: setup removes the links themselves, leaves what they
 * pointed at untouched, installs from the lockfile into the worktree, and
 * passes only when the result is a tree the native builds accept. In the main
 * checkout, whose installation is the shared one, it refuses.
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
  runGit(['init', '-q'], main);
  runGit(['add', '.'], main);
  runGit(['commit', '-qm', 'Fixture'], main);
  fs.mkdirSync(path.join(main, 'node_modules', 'react'), { recursive: true });
  fs.writeFileSync(path.join(main, 'node_modules', 'react', 'package.json'), '{}');
  fs.symlinkSync(path.join(main, 'modules', 'veloqrs'), path.join(main, 'node_modules', 'veloqrs'));
  const tree = path.join(parent, 'tree');
  runGit(['worktree', 'add', '-q', '--detach', tree], main);
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-setup-native-npm-'));
  dirs.push(bin);
  return { main, tree, bin };
}

function setup(root: string, npm: string) {
  return spawnSync(process.execPath, [script, '--root', root], {
    encoding: 'utf8',
    env: { ...gitFreeEnv(), VELOQ_NPM: npm },
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

  it('refuses in the main checkout, whose installation every worktree may share', () => {
    const { main, bin } = trees();

    const result = setup(main, fakeNpm(bin));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('main checkout');
    expect(fs.existsSync(path.join(bin, 'npm.log'))).toBe(false);
    expect(fs.existsSync(path.join(main, 'node_modules', 'react', 'package.json'))).toBe(true);
  });
});
