/**
 * Scenario: every agent runs the merge through a pipe for readability, which
 * is what `CLAUDE.md` shows. A pipeline's status is the last command's, so
 * `| tail -20` reports tail's 0 and a merge that lost the `update_ref` race
 * reads as success. The hook battery prints its PASS lines before the ref
 * moves, so the most convincing thing on screen is emitted on the losing path
 * too. That is how `audit/b786-5751` was reported merged and was not.
 *
 * Expected behaviour: the script says on its last line what happened and where
 * HEAD ended up. The absence of that line in piped output is then the signal,
 * whatever the pipeline's exit code says.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGit, gitFreeEnv } from '../__shared__/gitFixture';

const SCRIPT = join(__dirname, '../../../scripts/merge-audit-branch.sh');

const roots: string[] = [];

/** A checkout with `side` one commit ahead of `main`, ready to merge. */
function checkoutWithBranch(): string {
  const root = mkdtempSync(join(tmpdir(), 'merge-outcome-'));
  roots.push(root);
  writeFileSync(join(root, 'file.txt'), 'one\n');
  runGit(['init', '-q', '-b', 'main'], root);
  runGit(['add', 'file.txt'], root);
  runGit(['commit', '-q', '--no-verify', '-m', 'base'], root);

  runGit(['checkout', '-q', '-b', 'side'], root);
  writeFileSync(join(root, 'other.txt'), 'side\n');
  runGit(['add', 'other.txt'], root);
  runGit(['commit', '-q', '--no-verify', '-m', 'side change'], root);
  runGit(['checkout', '-q', 'main'], root);
  return root;
}

function runMerge(root: string, branch: string): { status: number; output: string } {
  // Its own lock directory. The real one is held by whatever the fleet is
  // merging, and a test that queues behind that waits for minutes.
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

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe('merge-audit-branch names its outcome', () => {
  it('prints the branch and the resulting HEAD on success', () => {
    const root = checkoutWithBranch();
    const { status, output } = runMerge(root, 'side');
    const head = runGit(['rev-parse', '--short', 'HEAD'], root).trim();

    expect(status).toBe(0);
    expect(output).toContain(`merge-audit-branch: side -> ${head}`);
  });

  it('puts the outcome on the last line, where a pipe cannot hide it', () => {
    const root = checkoutWithBranch();
    const { output } = runMerge(root, 'side');
    const lines = output.trimEnd().split('\n');

    expect(lines[lines.length - 1]).toMatch(/^merge-audit-branch: side -> [0-9a-f]+$/);
  });

  it('says the merge did not happen, and exits non-zero, when git refuses', () => {
    const root = checkoutWithBranch();
    const head = runGit(['rev-parse', '--short', 'HEAD'], root).trim();

    const { status, output } = runMerge(root, 'no-such-branch');

    expect(status).not.toBe(0);
    expect(output).toContain(
      `merge-audit-branch: no-such-branch NOT MERGED, HEAD is still ${head}`
    );
    expect(runGit(['rev-parse', '--short', 'HEAD'], root).trim()).toBe(head);
  });

  it('still names a branch it had nothing to merge', () => {
    const root = checkoutWithBranch();
    runMerge(root, 'side');
    const head = runGit(['rev-parse', '--short', 'HEAD'], root).trim();

    const { status, output } = runMerge(root, 'side');
    expect(status).toBe(0);
    expect(output).toContain(`merge-audit-branch: side -> ${head}`);
  });
});
