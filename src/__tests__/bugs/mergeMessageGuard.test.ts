/**
 * Scenario: every worktree merges into the one main checkout, so the index
 * there is shared. A session staged its own three files and ran `git commit`
 * with no pathspec while another session's merge sat staged. The commit
 * concluded that merge, under the wrong subject, carrying five files nobody
 * meant to commit. That is `fb644030`.
 *
 * Expected behaviour: a commit made while a merge is in progress has to say
 * it is a merge. An ordinary subject is refused, and the session is told to
 * leave the merge to whoever started it.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGit } from '../__shared__/gitFixture';

const SCRIPT = join(__dirname, '../../../scripts/check-merge-message.sh');

const roots: string[] = [];

/** A repository with a merge left in progress, the state a shared index reaches. */
function checkoutMidMerge(): string {
  const root = mkdtempSync(join(tmpdir(), 'merge-message-'));
  roots.push(root);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'file.txt'), 'one\n');
  runGit(['init', '-q', '-b', 'main'], root);
  runGit(['config', 'user.email', 'test@example.com'], root);
  runGit(['config', 'user.name', 'Test'], root);
  runGit(['add', 'file.txt'], root);
  runGit(['commit', '-q', '--no-verify', '-m', 'base'], root);

  runGit(['checkout', '-q', '-b', 'side'], root);
  writeFileSync(join(root, 'file.txt'), 'side\n');
  runGit(['commit', '-q', '--no-verify', '-am', 'side change'], root);

  runGit(['checkout', '-q', 'main'], root);
  writeFileSync(join(root, 'file.txt'), 'main\n');
  runGit(['commit', '-q', '--no-verify', '-am', 'main change'], root);

  // Conflicts, so git stops with MERGE_HEAD set and leaves the commit to the
  // session that started it.
  try {
    runGit(['merge', 'side'], root);
  } catch {
    // expected
  }
  return root;
}

/** A repository with nothing in flight. */
function settledCheckout(): string {
  const root = mkdtempSync(join(tmpdir(), 'merge-message-'));
  roots.push(root);
  writeFileSync(join(root, 'file.txt'), 'one\n');
  runGit(['init', '-q', '-b', 'main'], root);
  runGit(['config', 'user.email', 'test@example.com'], root);
  runGit(['config', 'user.name', 'Test'], root);
  runGit(['add', 'file.txt'], root);
  runGit(['commit', '-q', '--no-verify', '-m', 'base'], root);
  return root;
}

function runGuard(cwd: string, message: string): { status: number; output: string } {
  const file = join(cwd, 'message.txt');
  writeFileSync(file, message);
  try {
    const output = execFileSync('sh', [SCRIPT, file], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env },
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

describe('committing while a merge is in progress', () => {
  it('refuses an ordinary subject, and says whose merge it is not', () => {
    const root = checkoutMidMerge();

    const { status, output } = runGuard(root, 'Close B999, and record what it found\n');

    expect(status).toBe(1);
    expect(output).toContain('merge in progress');
  });

  it('allows the merge commit itself', () => {
    const root = checkoutMidMerge();

    expect(runGuard(root, "Merge branch 'side' into main\n").status).toBe(0);
  });

  it('allows an ordinary commit when nothing is in flight', () => {
    const root = settledCheckout();

    expect(runGuard(root, 'Close B999, and record what it found\n').status).toBe(0);
  });

  it('ignores the comment lines git appends to a message', () => {
    const root = checkoutMidMerge();

    const { status } = runGuard(
      root,
      "# Please enter a commit message\nMerge branch 'side' into main\n"
    );

    expect(status).toBe(0);
  });

  it('is wired into the commit-msg hook, or it guards nothing', () => {
    const hook = readFileSync(join(__dirname, '../../../.husky/commit-msg'), 'utf8');

    expect(hook).toContain('scripts/check-merge-message.sh');
    expect(hook).toContain('"$1"');
  });

  it('says nothing when it is handed no message at all', () => {
    const root = checkoutMidMerge();

    const output = execFileSync('sh', [SCRIPT], { cwd: root, encoding: 'utf8' });

    expect(output).toBe('');
  });
});
