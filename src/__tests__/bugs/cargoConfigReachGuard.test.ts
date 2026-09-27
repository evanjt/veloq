/**
 * Scenario: cargo resolves `.cargo/config.toml` from the working directory's
 * ancestors. The one on this machine sits beside the main checkout and carries
 * the job cap set after two builds at cargo's default reached 15.5 GB,
 * plus the corpus path the local bitwise gates read. A worktree placed outside
 * that parent reaches neither, and nothing says so: the build is simply faster
 * and hungrier.
 *
 * Expected behaviour: a guard that fails when the main checkout's config chain
 * sets `build.jobs` or `env.TRACEMATCH_CORPUS` and this tree's chain does not,
 * and stays quiet everywhere else, including a fresh clone with no such file,
 * which is every CI runner. The crate carries its own `.cargo/config.toml`, so
 * finding any config file proves nothing: cargo merges the whole chain.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runGit, gitFreeEnv } from '../__shared__/gitFixture';

const SCRIPT = join(__dirname, '../../../scripts/lint-cargo-config-reach.mjs');
const CRATE = 'modules/veloqrs/rust';
const PARENT_CONFIG =
  '[build]\njobs = 8\nrustc-wrapper = "sccache"\n\n[env]\nTRACEMATCH_CORPUS = "/corpus"\n';
const CRATE_CONFIG =
  '[target.aarch64-linux-android]\nrustflags = ["-C", "link-arg=-Wl,-z,max-page-size=16384"]\n';

function runGuard(root?: string): { status: number; output: string } {
  try {
    const output = execFileSync('node', root ? [SCRIPT, '--root', root] : [SCRIPT], {
      env: gitFreeEnv(),
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

/**
 * A main checkout whose crate holds its own tracked `.cargo/config.toml`, as
 * the real one does, with a parent config beside it when one is given.
 */
function mainCheckout(parentConfig: string | null): { parent: string; root: string } {
  const parent = mkdtempSync(join(tmpdir(), 'cargo-reach-'));
  parents.push(parent);
  const root = join(parent, 'veloq');
  mkdirSync(join(root, CRATE, '.cargo'), { recursive: true });
  if (parentConfig !== null) {
    mkdirSync(join(parent, '.cargo'));
    writeFileSync(join(parent, '.cargo/config.toml'), parentConfig);
  }
  runGit(['init', '-q'], root);
  writeFileSync(join(root, CRATE, 'Cargo.toml'), '[workspace]\n');
  writeFileSync(join(root, CRATE, '.cargo/config.toml'), CRATE_CONFIG);
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

it('passes for a worktree beside the main checkout, which resolves the config', () => {
  const main = mainCheckout(PARENT_CONFIG);
  expect(runGuard(worktree(main, main.parent)).status).toBe(0);
});

it('refuses a worktree outside the parent, and names both trees, the config and both keys', () => {
  const main = mainCheckout(PARENT_CONFIG);
  const elsewhere = mkdtempSync(join(tmpdir(), 'cargo-elsewhere-'));
  parents.push(elsewhere);

  const result = runGuard(worktree(main, elsewhere));

  expect(result.status).toBe(1);
  expect(result.output).toContain(join(elsewhere, 'veloq-fixture'));
  expect(result.output).toContain(main.root);
  expect(result.output).toContain(join(main.parent, '.cargo/config.toml'));
  expect(result.output).toContain('build.jobs');
  expect(result.output).toContain('env.TRACEMATCH_CORPUS');
});

it('names only the key this tree misses when a nearer config sets the other', () => {
  const main = mainCheckout(PARENT_CONFIG);
  const elsewhere = mkdtempSync(join(tmpdir(), 'cargo-partial-'));
  parents.push(elsewhere);
  mkdirSync(join(elsewhere, '.cargo'));
  writeFileSync(join(elsewhere, '.cargo/config'), 'build.jobs = 4\n');

  const result = runGuard(worktree(main, elsewhere));

  expect(result.status).toBe(1);
  expect(result.output).toContain('env.TRACEMATCH_CORPUS');
  expect(result.output).not.toContain('build.jobs');
});

it('passes a worktree elsewhere whose own ancestors set both keys', () => {
  const main = mainCheckout(PARENT_CONFIG);
  const elsewhere = mkdtempSync(join(tmpdir(), 'cargo-own-'));
  parents.push(elsewhere);
  mkdirSync(join(elsewhere, '.cargo'));
  writeFileSync(
    join(elsewhere, '.cargo/config.toml'),
    '[build]\njobs = 2\n[env.TRACEMATCH_CORPUS]\nvalue = "/other"\n'
  );

  expect(runGuard(worktree(main, elsewhere)).status).toBe(0);
});

it('does not require rustc-wrapper, which the parent config also sets', () => {
  const main = mainCheckout(PARENT_CONFIG);
  const elsewhere = mkdtempSync(join(tmpdir(), 'cargo-wrapper-'));
  parents.push(elsewhere);
  mkdirSync(join(elsewhere, '.cargo'));
  writeFileSync(
    join(elsewhere, '.cargo/config.toml'),
    '[build]\njobs = 8\n\n[env]\nTRACEMATCH_CORPUS = "/corpus"\n'
  );

  expect(runGuard(worktree(main, elsewhere)).status).toBe(0);
});

it('stays quiet when the main checkout sets neither key, only other tables', () => {
  const main = mainCheckout('[net]\nretry = 3\n');
  const elsewhere = mkdtempSync(join(tmpdir(), 'cargo-other-'));
  parents.push(elsewhere);

  expect(runGuard(worktree(main, elsewhere)).status).toBe(0);
});

it('stays quiet when the main checkout has no config either, which is CI', () => {
  const main = mainCheckout(null);
  const elsewhere = mkdtempSync(join(tmpdir(), 'cargo-ci-'));
  parents.push(elsewhere);

  expect(runGuard(worktree(main, elsewhere)).status).toBe(0);
});

it('stays quiet in a checkout that is not a worktree at all', () => {
  const main = mainCheckout(null);
  expect(runGuard(main.root).status).toBe(0);
});
