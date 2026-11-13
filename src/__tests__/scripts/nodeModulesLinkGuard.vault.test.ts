/**
 * Scenario: a job tree started with `node_modules` as a whole-directory link
 * to another job tree's install, which lacked packages this tree's Jest config
 * names, so the suite failed at config validation and read as a broken branch.
 *
 * Expected behaviour: in a linked worktree the guard refuses a `node_modules`
 * link that does not resolve to the main checkout's install, and names it. It
 * stays quiet on the main checkout, on a real directory and on a link to the
 * main checkout's install.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { gitFreeEnv, runGit } from '../__shared__/gitFixture';

const GUARD = resolve(__dirname, '../../../scripts/lint-node-modules-link.mjs');

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function mainCheckout(): string {
  const root = mkdtempSync(join(tmpdir(), 'nm-link-'));
  dirs.push(root);
  runGit(['init', '-q'], root);
  writeFileSync(join(root, 'a'), 'x\n');
  runGit(['add', '-A'], root);
  runGit(['-c', 'user.email=g@t.invalid', '-c', 'user.name=G', 'commit', '-qm', 'first'], root);
  mkdirSync(join(root, 'node_modules'));
  return root;
}

let count = 0;
function linked(main: string): string {
  const n = count++;
  const wt = join(main, `wt-${n}`);
  runGit(['worktree', 'add', '-q', '-b', `b${n}`, wt], main);
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

it('is quiet in a worktree with no node_modules yet', () => {
  expect(run(linked(mainCheckout())).code).toBe(0);
});

it('is quiet in a worktree with an install of its own', () => {
  const wt = linked(mainCheckout());
  mkdirSync(join(wt, 'node_modules'));
  expect(run(wt).code).toBe(0);
});

it('is quiet in a worktree linked to the main checkout install', () => {
  const main = mainCheckout();
  const wt = linked(main);
  symlinkSync(join(main, 'node_modules'), join(wt, 'node_modules'));
  expect(run(wt).code).toBe(0);
});

it('refuses a worktree linked to another worktree install, naming it', () => {
  const main = mainCheckout();
  const other = linked(main);
  mkdirSync(join(other, 'node_modules'));
  const wt = linked(main);
  symlinkSync(join(other, 'node_modules'), join(wt, 'node_modules'));
  const { code, out } = run(wt);
  expect(code).toBe(1);
  expect(out).toContain(join(other, 'node_modules'));
  expect(out).toContain('provision-job-tree.sh');
});

it('refuses a link that dangles', () => {
  const main = mainCheckout();
  const wt = linked(main);
  symlinkSync(join(main, 'gone', 'node_modules'), join(wt, 'node_modules'));
  expect(run(wt).code).toBe(1);
});
