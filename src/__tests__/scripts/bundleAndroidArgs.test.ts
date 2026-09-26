/**
 * Scenario: a worktree shares the main checkout's `node_modules`, so metro
 * serves the router entry out of the cache it filled for the main checkout and
 * the bundle comes out carrying no screen at all.
 *
 * Expected behaviour: the embed command resets the cache from a worktree, and
 * does not pay for it in the main checkout.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
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
  execFileSync('node', [SCRIPT, '--print-args'], { cwd: root, encoding: 'utf8' }).trim();

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

it('resets the metro cache when it runs from a worktree', () => {
  expect(argsIn(tree('file'))).toContain('--reset-cache');
});

it('leaves the cache alone in the main checkout', () => {
  expect(argsIn(tree('directory'))).not.toContain('--reset-cache');
});

it('writes where the Android build reads, either way', () => {
  for (const git of ['file', 'directory'] as const) {
    expect(argsIn(tree(git))).toContain(
      '--bundle-output android/app/src/main/assets/index.android.bundle'
    );
  }
});
