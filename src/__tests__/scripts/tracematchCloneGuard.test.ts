/**
 * Scenario: two jobs built side by side read one tracematch working tree, so
 * the second job's commit carried the first job's uncommitted detector edits.
 *
 * Expected behaviour: in a linked worktree the guard refuses a tracematch
 * directory that is a link, or whose git directory lives outside the worktree.
 * It stays quiet on the main checkout, on an absent submodule and on a clone
 * of its own.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { gitFreeEnv, runGit } from '../__shared__/gitFixture';

const GUARD = resolve(__dirname, '../../../scripts/lint-tracematch-clone.mjs');
const SUB = 'modules/veloqrs/rust/tracematch';

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function mainCheckout(): string {
  const root = mkdtempSync(join(tmpdir(), 'tm-clone-'));
  dirs.push(root);
  runGit(['init', '-q'], root);
  writeFileSync(join(root, 'a'), 'x\n');
  runGit(['add', '-A'], root);
  runGit(['-c', 'user.email=g@t.invalid', '-c', 'user.name=G', 'commit', '-qm', 'first'], root);
  mkdirSync(join(root, SUB), { recursive: true });
  runGit(['init', '-q'], join(root, SUB));
  return root;
}

function linked(main: string): string {
  const wt = join(main, `wt-${dirs.length}`);
  runGit(['worktree', 'add', '-q', '-b', `b${dirs.length}`, wt], main);
  mkdirSync(join(wt, SUB), { recursive: true });
  return wt;
}

function run(root: string) {
  try {
    return {
      code: 0,
      out: execFileSync('node', [GUARD, '--root', root], { env: gitFreeEnv(), encoding: 'utf8' }),
    };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

it('is quiet on the main checkout', () => {
  expect(run(mainCheckout()).code).toBe(0);
});

it('is quiet in a worktree whose submodule directory is empty', () => {
  expect(run(linked(mainCheckout())).code).toBe(0);
});

it('is quiet in a worktree with a clone of its own', () => {
  const wt = linked(mainCheckout());
  runGit(['init', '-q'], join(wt, SUB));
  expect(run(wt).code).toBe(0);
});

it('refuses a worktree whose tracematch directory links to the main checkout', () => {
  const main = mainCheckout();
  const wt = linked(main);
  rmSync(join(wt, SUB), { recursive: true });
  symlinkSync(join(main, SUB), join(wt, SUB));
  const { code, out } = run(wt);
  expect(code).toBe(1);
  expect(out).toContain(SUB);
});

it('refuses a worktree whose tracematch git directory sits outside it', () => {
  const main = mainCheckout();
  const wt = linked(main);
  writeFileSync(join(wt, SUB, '.git'), `gitdir: ${join(main, SUB, '.git')}\n`);
  expect(run(wt).code).toBe(1);
});
