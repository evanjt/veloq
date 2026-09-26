/**
 * Scenario: every worktree merges back through the one checkout, and a merge
 * there holds `pre-merge-commit`'s gates for five to eight minutes. Another
 * session's merge lands inside that window, `update_ref` fails, and the loser
 * leaves its merged tree staged against a `HEAD` that has moved. The next
 * session's merge is then refused for a file neither side touched, so one lost
 * race stops the whole fleet.
 *
 * Expected behaviour: `scripts/land-branch.sh` builds the merge in a worktree
 * of its own and fast-forwards the checkout, so the only step that races is a
 * ref move. It lands over an index another session has staged, because a
 * fast-forward checks out only the files the merge changed.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gitFreeEnv, runGit } from '../__shared__/gitFixture';

const SCRIPT = join(__dirname, '../../../scripts/land-branch.sh');

const roots: string[] = [];

function write(root: string, path: string, contents: string): void {
  const full = join(root, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, contents);
}

/**
 * A checkout on `main` with one branch to land. The branch adds a file of its
 * own, so a merge that lands can be told from one that did not by content
 * rather than by reachability.
 */
function checkoutWithBranch(): string {
  const root = mkdtempSync(join(tmpdir(), 'land-'));
  roots.push(root);
  write(root, 'base.txt', 'base\n');
  runGit(['init', '-q', '-b', 'main'], root);
  runGit(['add', '-A'], root);
  runGit(['commit', '-qm', 'base'], root);

  runGit(['checkout', '-q', '-b', 'audit/thing'], root);
  write(root, 'landed.txt', 'from the branch\n');
  runGit(['add', '-A'], root);
  runGit(['commit', '-qm', 'the branch'], root);
  runGit(['checkout', '-q', 'main'], root);
  return root;
}

function land(root: string, branch: string): { status: number; output: string } {
  try {
    const output = execFileSync('bash', [SCRIPT, branch], {
      cwd: root,
      env: { ...gitFreeEnv(), VELOQ_LAND_ATTEMPTS: '2', VELOQ_LAND_SLEEP: '0' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe('landing a branch', () => {
  it('lands it, and the content is there rather than merely reachable', () => {
    const root = checkoutWithBranch();

    const { status, output } = land(root, 'audit/thing');

    expect(status).toBe(0);
    expect(output).toContain('landed audit/thing');
    expect(readFileSync(join(root, 'landed.txt'), 'utf8')).toBe('from the branch\n');
  });

  /**
   * The defect this exists for. `git merge` refuses while the index differs
   * from `HEAD` for any path it would check out, so one session's staged files
   * stopped every other session's merge for about ninety minutes on
   * 2026-09-15.
   */
  it('lands over another session’s staged work, and leaves it staged', () => {
    const root = checkoutWithBranch();
    write(root, 'someone-elses.txt', 'mid-merge, not mine\n');
    runGit(['add', 'someone-elses.txt'], root);

    const { status } = land(root, 'audit/thing');

    expect(status).toBe(0);
    expect(readFileSync(join(root, 'landed.txt'), 'utf8')).toBe('from the branch\n');
    expect(runGit(['diff', '--cached', '--name-only'], root).trim()).toBe('someone-elses.txt');
  });

  it('refuses a branch that does not exist rather than half landing one', () => {
    const root = checkoutWithBranch();

    const { status, output } = land(root, 'audit/never-was');

    expect(status).not.toBe(0);
    expect(output).toMatch(/audit\/never-was/);
    expect(runGit(['log', '--oneline', '-1'], root)).toContain('base');
  });

  /** A conflict is the author's to resolve, and must leave the checkout alone. */
  it('leaves the checkout untouched when the merge conflicts', () => {
    const root = checkoutWithBranch();
    write(root, 'landed.txt', 'from main instead\n');
    runGit(['add', '-A'], root);
    runGit(['commit', '-qm', 'main writes the same file'], root);
    const before = runGit(['rev-parse', 'HEAD'], root).trim();

    const { status, output } = land(root, 'audit/thing');

    expect(status).not.toBe(0);
    expect(output).toMatch(/conflict/i);
    expect(runGit(['rev-parse', 'HEAD'], root).trim()).toBe(before);
    expect(runGit(['status', '--porcelain'], root).trim()).toBe('');
  });
});

/**
 * The other half of the defect. The loser of a ref race leaves no `MERGE_HEAD`,
 * so `git merge --abort` refuses and `git status` reads like somebody's work in
 * progress. Two sessions broadcast to the fleet hunting the holder before the
 * cause was found.
 */
describe('a checkout carrying a stranded merge', () => {
  it('is named, with what it holds and how it is cleared', () => {
    const root = checkoutWithBranch();
    // The wreckage: the same path the branch writes, staged against a HEAD
    // that has no merge in progress, so the fast-forward is refused.
    write(root, 'landed.txt', 'somebody else half landed this\n');
    runGit(['add', 'landed.txt'], root);

    const { status, output } = land(root, 'audit/thing');

    expect(status).not.toBe(0);
    expect(output).toContain('staged tree with no merge in progress');
    expect(output).toContain('landed.txt');
    expect(output).toContain('git reset --hard HEAD');
    expect(output).toContain('Do not clear another session');
  });
});
