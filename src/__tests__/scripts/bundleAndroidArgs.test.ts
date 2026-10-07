/**
 * Scenario: a release bundle is embedded from a worktree. Metro's cache is
 * shared by every checkout on the machine, and the worktree's installation may
 * be links into another checkout.
 *
 * Expected behaviour: the embed command keeps the cache, whose identity is per
 * checkout, and refuses to start from a tree whose installation is another
 * checkout's.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/bundle-android.mjs');

const roots: string[] = [];

function tree(git: 'file' | 'directory'): string {
  const root = mkdtempSync(join(tmpdir(), 'bundle-android-'));
  roots.push(root);
  if (git === 'file') {
    writeFileSync(join(root, '.git'), 'gitdir: /elsewhere/.git/worktrees/x\n');
  } else {
    mkdirSync(join(root, '.git'));
  }
  return root;
}

const argsIn = (root: string) =>
  execFileSync('node', [SCRIPT, '--print-args'], {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'production' },
    encoding: 'utf8',
  }).trim();

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

it('keeps the metro cache in a worktree and in the main checkout', () => {
  for (const git of ['file', 'directory'] as const) {
    expect(argsIn(tree(git))).not.toContain('--reset-cache');
  }
});

it('writes where the Android build reads, either way', () => {
  for (const git of ['file', 'directory'] as const) {
    expect(argsIn(tree(git))).toContain(
      '--bundle-output android/app/src/main/assets/index.android.bundle'
    );
  }
});

it('refuses to bundle from a tree whose installation is another checkout', () => {
  const root = tree('file');
  const elsewhere = mkdtempSync(join(tmpdir(), 'bundle-android-main-'));
  roots.push(elsewhere);
  mkdirSync(join(elsewhere, 'node_modules'));
  symlinkSync(join(elsewhere, 'node_modules'), join(root, 'node_modules'));

  const run = spawnSync('node', [SCRIPT], {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'production' },
    encoding: 'utf8',
  });

  expect(run.status).toBe(1);
  expect(run.stderr).toContain('npm run setup:native');
  expect(existsSync(join(root, 'android'))).toBe(false);
});

it('rejects a release bundle under a non-production NODE_ENV', () => {
  const run = spawnSync('node', [SCRIPT, '--print-args'], {
    cwd: tree('file'),
    env: { ...process.env, NODE_ENV: 'development' },
    encoding: 'utf8',
  });
  expect(run.status).toBe(1);
  expect(run.stderr).toContain('NODE_ENV=production');
});
