/**
 * Scenario: the pre-commit hook runs `npm test`, and git hands every hook
 * `GIT_DIR` and `GIT_INDEX_FILE`. Those beat `cwd`, so a test that builds a
 * temporary git fixture writes the real repository's index instead, and the
 * commit that follows holds one file and deletes the rest.
 *
 * Expected behaviour: nothing a test runs against a fixture may touch the
 * surrounding repository, and a guard script pointed at a fixture must read
 * the fixture's files rather than the repository's.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { gitFreeEnv, initFixtureRepo, runGit } from '../__shared__/gitFixture';

/** Each guard, with a file only it objects to. */
const GUARDS = [
  {
    name: 'comment line references',
    script: 'scripts/lint-comment-line-refs.mjs',
    path: 'src/a.ts',
    violating: ' * 1. Training load (lines 62-130):\nexport const a = 1;\n',
  },
  {
    name: 'em dashes',
    script: 'scripts/lint-em-dashes.mjs',
    path: 'src/b.ts',
    violating: '// a dash \u2014 here\nexport const b = 1;\n',
  },
  {
    name: 'Australian spelling',
    script: 'scripts/lint-au-spelling.mjs',
    path: 'modules/veloqrs/rust/veloqrs/src/c.rs',
    violating: 'pub fn normalize_features() {}\n',
  },
] as const;

const roots: string[] = [];

function tempDir(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function write(root: string, path: string, contents: string): void {
  const full = join(root, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, contents);
}

/**
 * A repository standing in for the one a hook would hand us. `files` seeds it,
 * so a guard that resolves this repository rather than the fixture it was
 * pointed at gives itself away.
 */
function surroundingRepo(files: Record<string, string> = {}): {
  root: string;
  tracked: () => string;
} {
  const root = tempDir('surrounding-');
  write(root, 'src/kept.ts', 'export const kept = 1;\n');
  write(root, 'src/also-kept.ts', 'export const also = 2;\n');
  for (const [path, contents] of Object.entries(files)) write(root, path, contents);
  initFixtureRepo(root);
  return { root, tracked: () => runGit(['ls-files'], root) };
}

/** The environment a gate sees when git runs the hook. */
function hookEnv(repoRoot: string): NodeJS.ProcessEnv {
  return {
    ...gitFreeEnv(),
    GIT_DIR: join(repoRoot, '.git'),
    GIT_INDEX_FILE: join(repoRoot, '.git', 'index'),
    GIT_WORK_TREE: repoRoot,
  };
}

function runGuard(script: string, root: string, env: NodeJS.ProcessEnv) {
  const result = execFileSync('node', [script, '--root', root], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    // A guard that fails exits 1, which execFileSync would throw on.
  });
  return result;
}

function guardStatus(script: string, root: string, env: NodeJS.ProcessEnv): number {
  try {
    runGuard(script, root, env);
    return 0;
  } catch (e) {
    return (e as { status?: number }).status ?? -1;
  }
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe('a lint guard run from inside the hook', () => {
  it('builds its fixture without touching the surrounding index', () => {
    const surrounding = surroundingRepo();
    const before = surrounding.tracked();

    const fixture = tempDir('fixture-');
    write(fixture, 'src/f.ts', 'export const f = 1;\n');
    const saved = process.env;
    process.env = hookEnv(surrounding.root);
    try {
      initFixtureRepo(fixture);
    } finally {
      process.env = saved;
    }

    expect(surrounding.tracked()).toBe(before);
  });

  it.each(GUARDS)('$name passes a clean fixture beside a dirty repository', (guard) => {
    const surrounding = surroundingRepo({ [guard.path]: guard.violating });
    const clean = tempDir('clean-');
    write(clean, 'src/ok.ts', 'export const ok = 1;\n');
    initFixtureRepo(clean);

    expect(guardStatus(guard.script, clean, hookEnv(surrounding.root))).toBe(0);
  });

  it.each(GUARDS)('$name fails a dirty fixture beside a clean repository', (guard) => {
    const surrounding = surroundingRepo();
    const dirty = tempDir('dirty-');
    write(dirty, guard.path, guard.violating);
    initFixtureRepo(dirty);

    expect(guardStatus(guard.script, dirty, hookEnv(surrounding.root))).toBe(1);
  });
});
