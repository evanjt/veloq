/**
 * Scenario: `veloq` records the tracematch commit it wants as a submodule
 * pointer, and the submodule's own working tree is checked out separately. They
 * drift: a merge that moves the pointer leaves the tree where it was, so
 * `cargo test` and a release build compile the tracematch on disk while the
 * commit names another one. A gate goes green against code the branch does not
 * contain, and the only signal is a bare `M modules/veloqrs/rust/tracematch` in
 * `git status`, which every agent already sees beside the clone recipe's noise.
 *
 * Expected behaviour: a guard that fails when the checked-out submodule commit
 * is not the one the tree records, and names both. A submodule that is absent or
 * not yet initialised is not this guard's problem: a fresh worktree has neither
 * until the clone recipe runs, and a detached HEAD equal to the pointer is
 * exactly right.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runGit } from '../__shared__/gitFixture';

const SCRIPT = join(__dirname, '../../../scripts/lint-submodule-pointer.mjs');
const SUB = 'modules/veloqrs/rust/tracematch';

function runGuard(root?: string): { status: number; output: string } {
  try {
    const output = execFileSync('node', root ? [SCRIPT, '--root', root] : [SCRIPT], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

const roots: string[] = [];

/** A tracematch-shaped repository with two commits, newest first. */
function submoduleRepo(): { path: string; head: string; parent: string } {
  const path = mkdtempSync(join(tmpdir(), 'sub-pointer-sub-'));
  roots.push(path);
  runGit(['init', '-q', '-b', 'main'], path);
  writeFileSync(join(path, 'a.txt'), 'one\n');
  runGit(['add', 'a.txt'], path);
  commit(path, 'one');
  const parent = rev(path);
  writeFileSync(join(path, 'a.txt'), 'two\n');
  runGit(['add', 'a.txt'], path);
  commit(path, 'two');
  return { path, head: rev(path), parent };
}

function commit(cwd: string, message: string): void {
  runGit(
    [
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@t',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-q',
      '-m',
      message,
    ],
    cwd
  );
}

function rev(cwd: string): string {
  return runGit(['rev-parse', 'HEAD'], cwd).trim();
}

/**
 * A superproject whose recorded pointer is `pointer` and whose submodule tree
 * sits at `checkout`. Written by hand rather than with `git submodule add`,
 * which needs `protocol.file.allow` and a network-shaped URL.
 */
function superproject(sub: { path: string; head: string; parent: string }, at: string): string {
  const root = mkdtempSync(join(tmpdir(), 'sub-pointer-super-'));
  roots.push(root);
  runGit(['init', '-q', '-b', 'main'], root);
  mkdirSync(join(root, SUB), { recursive: true });
  writeFileSync(join(root, 'keep.txt'), 'x\n');
  runGit(['add', 'keep.txt'], root);
  // The pointer is a gitlink, staged directly so no clone or protocol flag is
  // needed to record one.
  runGit(['update-index', '--add', '--cacheinfo', `160000,${sub.head},${SUB}`], root);
  commit(root, 'record the pointer');
  rmSync(join(root, SUB), { recursive: true, force: true });
  runGit(['clone', '-q', '--no-checkout', sub.path, SUB], root);
  runGit(['-C', SUB, 'checkout', '-q', at], root);
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

it('exits 0 on this checkout, so the audit gate stays usable', () => {
  expect(runGuard().status).toBe(0);
});

it('passes when the submodule sits at the commit the tree records', () => {
  const sub = submoduleRepo();
  expect(runGuard(superproject(sub, sub.head)).status).toBe(0);
});

/**
 * The shape observed on 2026-09-12: a merge moved the pointer forward and the
 * working tree stayed on an ancestor, so every Rust build read the older
 * detector.
 */
it('fails when the submodule is behind the pointer, and names both commits', () => {
  const sub = submoduleRepo();
  const { status, output } = runGuard(superproject(sub, sub.parent));
  expect(status).toBe(1);
  expect(output).toContain(sub.head.slice(0, 7));
  expect(output).toContain(sub.parent.slice(0, 7));
});

it('fails when the submodule is ahead of the pointer too', () => {
  const sub = submoduleRepo();
  const root = superproject(sub, sub.parent);
  // Record the older commit, leave the tree on the newer one.
  runGit(['update-index', '--cacheinfo', `160000,${sub.parent},${SUB}`], root);
  commit(root, 'record the older pointer');
  runGit(['-C', SUB, 'checkout', '-q', sub.head], root);
  expect(runGuard(root).status).toBe(1);
});

it('says nothing when the submodule directory is absent, which is a fresh worktree', () => {
  const sub = submoduleRepo();
  const root = superproject(sub, sub.head);
  rmSync(join(root, SUB), { recursive: true, force: true });
  expect(runGuard(root).status).toBe(0);
});

it('says nothing when the submodule is present but not a repository', () => {
  const sub = submoduleRepo();
  const root = superproject(sub, sub.head);
  rmSync(join(root, SUB), { recursive: true, force: true });
  mkdirSync(join(root, SUB), { recursive: true });
  expect(runGuard(root).status).toBe(0);
});

it('says nothing when the tree records no pointer at all', () => {
  const root = mkdtempSync(join(tmpdir(), 'sub-pointer-none-'));
  roots.push(root);
  runGit(['init', '-q', '-b', 'main'], root);
  writeFileSync(join(root, 'keep.txt'), 'x\n');
  runGit(['add', 'keep.txt'], root);
  commit(root, 'no submodule');
  expect(runGuard(root).status).toBe(0);
});
