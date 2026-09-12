/**
 * Scenario: cargo resolves `.cargo/config.toml` from the working directory's
 * ancestors. The one on this machine sits beside the main checkout and carries
 * the job cap set after two builds at cargo's default reached 15.5 GB,
 * plus the corpus path the local bitwise gates read. A worktree placed outside
 * that parent reaches neither, and nothing says so: the build is simply faster
 * and hungrier.
 *
 * Expected behaviour: a guard that fails when the main checkout resolves a
 * config and this tree does not, and stays quiet everywhere else, including a
 * fresh clone with no such file, which is every CI runner.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runGit } from '../__shared__/gitFixture';

const SCRIPT = join(__dirname, '../../../scripts/lint-cargo-config-reach.mjs');
const CRATE = 'modules/veloqrs/rust';

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

const parents: string[] = [];

/** A main checkout, with a `.cargo/config.toml` beside it when asked. */
function mainCheckout(withConfig: boolean): { parent: string; root: string } {
  const parent = mkdtempSync(join(tmpdir(), 'cargo-reach-'));
  parents.push(parent);
  const root = join(parent, 'veloq');
  mkdirSync(join(root, CRATE), { recursive: true });
  if (withConfig) {
    mkdirSync(join(parent, '.cargo'));
    writeFileSync(join(parent, '.cargo/config.toml'), '[build]\njobs = 8\n');
  }
  runGit(['init', '-q'], root);
  writeFileSync(join(root, CRATE, 'Cargo.toml'), '[workspace]\n');
  runGit(['add', '-A'], root);
  runGit(['commit', '-q', '-m', 'fixture', '--no-verify'], root);
  return { parent, root };
}

/** A real worktree of `main`, placed under `at`. */
function worktree(main: { root: string }, at: string): string {
  const root = join(at, 'veloq-fixture');
  runGit(['worktree', 'add', '-q', '--detach', root], main.root);
  return root;
}

afterAll(() => {
  for (const parent of parents) rmSync(parent, { recursive: true, force: true });
});

it('exits 0 on this checkout, so the audit gate stays usable', () => {
  expect(runGuard().status).toBe(0);
});

it('passes for a worktree beside the main checkout, which resolves the config', () => {
  const main = mainCheckout(true);
  expect(runGuard(worktree(main, main.parent)).status).toBe(0);
});

it('refuses a worktree outside the parent, and names both trees and the config', () => {
  const main = mainCheckout(true);
  const elsewhere = mkdtempSync(join(tmpdir(), 'cargo-elsewhere-'));
  parents.push(elsewhere);

  const result = runGuard(worktree(main, elsewhere));

  expect(result.status).toBe(1);
  expect(result.output).toContain(join(elsewhere, 'veloq-fixture'));
  expect(result.output).toContain(main.root);
  expect(result.output).toContain(join(main.parent, '.cargo/config.toml'));
});

it('stays quiet when the main checkout has no config either, which is CI', () => {
  const main = mainCheckout(false);
  const elsewhere = mkdtempSync(join(tmpdir(), 'cargo-ci-'));
  parents.push(elsewhere);

  expect(runGuard(worktree(main, elsewhere)).status).toBe(0);
});

it('stays quiet in a checkout that is not a worktree at all', () => {
  const main = mainCheckout(false);
  expect(runGuard(main.root).status).toBe(0);
});
