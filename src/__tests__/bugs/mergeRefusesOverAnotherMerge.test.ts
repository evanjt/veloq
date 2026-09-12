/**
 * Scenario: an agent merges by hand, or from a session that predates the lock
 * split, so it holds no merge lock. Its merge conflicts and sits unresolved.
 * The next scripted merge takes the lock, runs `git merge` into that checkout
 * and git answers "Exiting because of an unresolved conflict". The output
 * named nothing about whose merge was in the way and printed the recovery for
 * a lost update-ref race instead, which sends the reader towards
 * `git merge --abort` on someone else's merge, or towards finishing it under
 * their own subject.
 *
 * Expected behaviour: the script refuses before it merges, names the commit
 * that holds the checkout and says it is not this agent's to finish or abort.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGit, gitFreeEnv } from '../__shared__/gitFixture';

const SCRIPT = join(__dirname, '../../../scripts/merge-audit-branch.sh');

const roots: string[] = [];

/**
 * A checkout with two branches that both changed the same line, so merging
 * one after the other conflicts.
 */
function checkoutWithConflict(): string {
  const root = mkdtempSync(join(tmpdir(), 'merge-refuse-'));
  roots.push(root);
  writeFileSync(join(root, 'file.txt'), 'base\n');
  runGit(['init', '-q', '-b', 'main'], root);
  runGit(['add', 'file.txt'], root);
  runGit(['commit', '-q', '--no-verify', '-m', 'base'], root);

  // `theirs` fights `main` over file.txt; `mine` touches its own file, so the
  // only thing that can stop it is the merge already in progress.
  for (const [branch, file, text] of [
    ['theirs', 'file.txt', 'theirs\n'],
    ['mine', 'other.txt', 'mine\n'],
  ]) {
    runGit(['checkout', '-q', '-b', branch, 'main'], root);
    writeFileSync(join(root, file), text);
    runGit(['add', file], root);
    runGit(['commit', '-q', '--no-verify', '-m', `${branch} change`], root);
  }
  // `main` moves too, or merging `theirs` into it has nothing to conflict with.
  runGit(['checkout', '-q', 'main'], root);
  writeFileSync(join(root, 'file.txt'), 'main\n');
  runGit(['add', 'file.txt'], root);
  runGit(['commit', '-q', '--no-verify', '-m', 'main change'], root);
  return root;
}

function runMerge(root: string, branch: string): { status: number; output: string } {
  const env = { ...gitFreeEnv(), VELOQ_LOCK_DIR: root };
  try {
    const output = execFileSync('sh', [SCRIPT, branch], {
      cwd: root,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

/** Leave an unresolved merge standing, the way an unlocked hand merge does. */
function leaveMergeInProgress(root: string): string {
  try {
    runGit(['merge', '--no-ff', '--no-edit', 'theirs'], root);
  } catch {
    // The conflict is the point.
  }
  expect(existsSync(join(root, '.git', 'MERGE_HEAD'))).toBe(true);
  return runGit(['rev-parse', 'theirs'], root).trim();
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe('merging into a checkout that already has a merge in progress', () => {
  it('refuses rather than running git merge', () => {
    const root = checkoutWithConflict();
    leaveMergeInProgress(root);

    const { status, output } = runMerge(root, 'mine');

    expect(status).not.toBe(0);
    expect(output).toContain('merge already in progress');
    expect(output).not.toContain('Check content, not reachability');
  });

  it('names the commit that holds the checkout', () => {
    const root = checkoutWithConflict();
    const theirs = leaveMergeInProgress(root);

    const { output } = runMerge(root, 'mine');

    expect(output).toContain(theirs.slice(0, 7));
    expect(output).toContain('theirs change');
  });

  it('says it is not this agent’s merge to finish or abort', () => {
    const root = checkoutWithConflict();
    leaveMergeInProgress(root);

    const { output } = runMerge(root, 'mine');

    expect(output).toMatch(/not yours to (finish|abort)/i);
  });

  it('leaves the other merge exactly as it found it', () => {
    const root = checkoutWithConflict();
    const theirs = leaveMergeInProgress(root);

    runMerge(root, 'mine');

    expect(runGit(['rev-parse', 'MERGE_HEAD'], root).trim()).toBe(theirs);
  });

  it('merges normally once the checkout is clear', () => {
    const root = checkoutWithConflict();
    leaveMergeInProgress(root);
    runGit(['merge', '--abort'], root);

    const { status, output } = runMerge(root, 'mine');

    expect(status).toBe(0);
    expect(output).toContain('merge-audit-branch: mine ->');
  });
});
