/**
 * Scenario: `core.hooksPath` was an absolute path into the main checkout, so a
 * commit made inside a worktree ran the main checkout's pre-commit hook. The
 * commit that came out held only the staged files and deleted every other
 * tracked file, 420,935 lines of them, four times in one session.
 *
 * Expected behaviour: a hook that does not belong to the working tree being
 * committed refuses the commit instead of rewriting it, and says how to fix
 * the config. The same guard refuses a commit whose index is not the
 * repository's own, which is what a pathspec commit hands the hook.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/check-commit-index.sh');

const roots: string[] = [];

/** A repository with a `.husky/pre-commit`, the shape the guard is called from. */
function checkout(): string {
  const root = mkdtempSync(join(tmpdir(), 'commit-index-'));
  roots.push(root);
  mkdirSync(join(root, '.husky'), { recursive: true });
  writeFileSync(join(root, '.husky', 'pre-commit'), '#!/bin/sh\nexit 0\n');
  writeFileSync(join(root, 'file.txt'), 'one\n');
  execFileSync('git', ['init', '-q'], { cwd: root });
  return root;
}

function runGuard(
  cwd: string,
  hookPath: string,
  env: Record<string, string> = {}
): { status: number; output: string } {
  try {
    const output = execFileSync('sh', [SCRIPT, hookPath], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, ...env },
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

describe('the pre-commit guard', () => {
  it('passes the hook that belongs to the working tree', () => {
    const root = checkout();

    expect(runGuard(root, join(root, '.husky', 'pre-commit')).status).toBe(0);
  });

  it("refuses another checkout's hook, which is what a worktree ran", () => {
    const worktree = checkout();
    const main = checkout();

    const { status, output } = runGuard(worktree, join(main, '.husky', 'pre-commit'));

    expect(status).toBe(1);
    expect(output).toContain('core.hooksPath');
  });

  it('names both trees so the mismatch is readable', () => {
    const worktree = checkout();
    const main = checkout();

    const { output } = runGuard(worktree, join(main, '.husky', 'pre-commit'));

    expect(output).toContain(worktree);
    expect(output).toContain(main);
  });

  it("passes when GIT_INDEX_FILE is the repository's own index", () => {
    const root = checkout();

    expect(
      runGuard(root, join(root, '.husky', 'pre-commit'), {
        GIT_INDEX_FILE: join(root, '.git', 'index'),
      }).status
    ).toBe(0);
  });

  it('refuses the temporary index a pathspec commit builds', () => {
    const root = checkout();

    const { status, output } = runGuard(root, join(root, '.husky', 'pre-commit'), {
      GIT_INDEX_FILE: join(root, '.git', 'next-index-12345'),
    });

    expect(status).toBe(1);
    expect(output).toContain('git add');
  });

  it('passes a relative GIT_INDEX_FILE, which is still the real index', () => {
    const root = checkout();

    expect(
      runGuard(root, join(root, '.husky', 'pre-commit'), { GIT_INDEX_FILE: '.git/index' }).status
    ).toBe(0);
  });
});
