/**
 * Scenario: tracematch's pre-commit hook refuses GPS traces, but it runs only
 * where `core.hooksPath` is `.githooks`, which is per-clone config nothing in
 * veloq set. The submodule is the only tracematch checkout that takes commits,
 * so traces committed there went through with no hook at all.
 *
 * Expected behaviour: the linker points the submodule at its own hooks, and
 * never writes the superproject's config when the submodule directory is empty,
 * where git would resolve to the superproject instead.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gitFreeEnv, runGit } from '../__shared__/gitFixture';

const LINKER = join(__dirname, '../../../scripts/link-tracematch-hooks.mjs');
const SUB = 'modules/veloqrs/rust/tracematch';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function superproject(): string {
  const root = mkdtempSync(join(tmpdir(), 'tracematch-hooks-'));
  roots.push(root);
  runGit(['init', '-q'], root);
  mkdirSync(join(root, SUB), { recursive: true });
  return root;
}

function submodule(root: string, withHooks = true): string {
  const sub = join(root, SUB);
  runGit(['init', '-q'], sub);
  if (withHooks) {
    mkdirSync(join(sub, '.githooks'));
    writeFileSync(join(sub, '.githooks/pre-commit'), '#!/bin/sh\n');
  }
  return sub;
}

function hooksPath(cwd: string): string {
  try {
    return runGit(['config', '--local', '--get', 'core.hooksPath'], cwd).trim();
  } catch {
    return '';
  }
}

const link = (root: string) =>
  execFileSync('node', [LINKER, '--root', root], { env: gitFreeEnv(), encoding: 'utf8' });

it('points the submodule at its tracked hooks', () => {
  const root = superproject();
  const sub = submodule(root);
  link(root);
  expect(hooksPath(sub)).toBe('.githooks');
  expect(hooksPath(root)).toBe('');
});

it('leaves a submodule already pointed there as it is, on the second run', () => {
  const root = superproject();
  const sub = submodule(root);
  link(root);
  link(root);
  expect(hooksPath(sub)).toBe('.githooks');
});

it('writes nothing when the submodule directory is empty', () => {
  const root = superproject();
  link(root);
  expect(hooksPath(root)).toBe('');
});

it('writes nothing when there is no submodule directory at all', () => {
  const root = mkdtempSync(join(tmpdir(), 'tracematch-hooks-'));
  roots.push(root);
  runGit(['init', '-q'], root);
  link(root);
  expect(hooksPath(root)).toBe('');
});

it('writes nothing for a pin that carries no .githooks, which would disable every hook', () => {
  const root = superproject();
  const sub = submodule(root, false);
  link(root);
  expect(hooksPath(sub)).toBe('');
});

it('writes nothing and still exits cleanly for a submodule whose git directory is gone', () => {
  const root = superproject();
  writeFileSync(join(root, SUB, '.git'), 'gitdir: ../../../../.git/modules/missing\n');
  mkdirSync(join(root, SUB, '.githooks'));
  expect(() => link(root)).not.toThrow();
  expect(hooksPath(root)).toBe('');
});
