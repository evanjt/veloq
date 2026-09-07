/**
 * Scenario: `node_modules/veloqrs` is one symlink shared by every checkout on
 * the machine, because a worktree links the whole `node_modules` to the main
 * one. An agent building natively in a worktree repoints it at that worktree,
 * which is what `CLAUDE.md` tells it to do, and nothing puts it back. Every
 * other checkout then resolves `veloqrs` to a branch it knows nothing about:
 * `tsc` reports errors for methods that exist, and Metro and a release bundle
 * ship that branch's engine module.
 *
 * Expected behaviour: a guard that fails when the link does not resolve to the
 * module of the checkout it sits in, and names both paths so the fix is
 * obvious. A missing link is not this guard's problem, that is an install.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, symlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runGit } from '../__shared__/gitFixture';

const SCRIPT = join(__dirname, '../../../scripts/lint-module-link.mjs');

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

/** A checkout whose `node_modules/veloqrs` points wherever `target` says. */
function checkout(target?: (root: string) => string): string {
  const root = mkdtempSync(join(tmpdir(), 'module-link-'));
  roots.push(root);
  mkdirSync(join(root, 'modules/veloqrs'), { recursive: true });
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  if (target) symlinkSync(target(root), join(root, 'node_modules/veloqrs'));
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

it('exits 0 on this checkout, so the audit gate stays usable', () => {
  expect(runGuard().status).toBe(0);
});

it('passes when the link resolves to this checkout', () => {
  expect(runGuard(checkout((root) => join(root, 'modules/veloqrs'))).status).toBe(0);
});

it('fails when the link points at another checkout, and names both paths', () => {
  const other = checkout((root) => join(root, 'modules/veloqrs'));
  const { status, output } = runGuard(checkout(() => join(other, 'modules/veloqrs')));

  expect(status).toBe(1);
  expect(output).toContain(join(other, 'modules/veloqrs'));
  expect(output).toContain('modules/veloqrs');
});

it('says nothing when there is no link at all, which is an install', () => {
  expect(runGuard(checkout()).status).toBe(0);
});

it('accepts a real directory rather than a link, which a per-tree copy is', () => {
  const root = mkdtempSync(join(tmpdir(), 'module-link-'));
  roots.push(root);
  mkdirSync(join(root, 'modules/veloqrs'), { recursive: true });
  mkdirSync(join(root, 'node_modules/veloqrs'), { recursive: true });

  expect(runGuard(root).status).toBe(0);
});

/**
 * The rest is about a worktree, where the link cannot point at both trees. It
 * rests on the main checkout, which is where every worktree's typecheck is
 * documented to read from, so that target is right and a third tree is not.
 */
function mainWithWorktree(): { main: string; tree: string } {
  const main = mkdtempSync(join(tmpdir(), 'module-link-main-'));
  roots.push(main);
  mkdirSync(join(main, 'modules/veloqrs'), { recursive: true });
  mkdirSync(join(main, 'node_modules'), { recursive: true });
  writeFileSync(join(main, 'modules/veloqrs/index.ts'), 'export const a = 1;\n');
  runGit(['init', '-q'], main);
  runGit(['add', '-A'], main);
  runGit(['-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture'], main);

  const tree = join(main, '..', `${main.split('/').pop()}-wt`);
  roots.push(tree);
  runGit(['worktree', 'add', '-q', tree, '-b', 'wt'], main);
  mkdirSync(join(tree, 'node_modules'), { recursive: true });
  return { main, tree };
}

it('lets a worktree rest on the main checkout, which is where it reads from', () => {
  const { main, tree } = mainWithWorktree();
  symlinkSync(join(main, 'modules/veloqrs'), join(tree, 'node_modules/veloqrs'));

  expect(runGuard(tree).status).toBe(0);
});

it('lets a worktree point at itself, which a native build there needs', () => {
  const { tree } = mainWithWorktree();
  symlinkSync(join(tree, 'modules/veloqrs'), join(tree, 'node_modules/veloqrs'));

  expect(runGuard(tree).status).toBe(0);
});

it('refuses a worktree pointing at a third tree, which is the reported failure', () => {
  const { main, tree } = mainWithWorktree();
  const other = checkout((root) => join(root, 'modules/veloqrs'));
  symlinkSync(join(other, 'modules/veloqrs'), join(tree, 'node_modules/veloqrs'));

  const { status, output } = runGuard(tree);
  expect(status).toBe(1);
  expect(output).toContain(join(other, 'modules/veloqrs'));
  expect(output).toContain(join(main, 'modules/veloqrs'));
});
