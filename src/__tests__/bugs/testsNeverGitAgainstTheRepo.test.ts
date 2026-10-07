/**
 * Scenario: git exports `GIT_DIR`, `GIT_INDEX_FILE` and `GIT_WORK_TREE` to
 * everything a hook runs, and those beat `cwd`. A test that builds a fixture
 * checkout and runs `git init` and `git add -A` in it therefore writes the
 * *repository's* index whenever the suite runs from `pre-commit` or
 * `pre-merge-commit`. Measured 2026-09-15: a merge left the worktree's index
 * holding the fixture's two files in place of 3,012, `git merge --abort` then
 * refused, and the engine-surface ratchet read the wreckage as a regression in
 * whichever branch was being merged.
 *
 * Expected behaviour: a test that shells out to git goes through
 * `__shared__/gitFixture`, which strips the eight inherited pointers. The
 * helper existing is not enough, because it was there and unused.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const TESTS = resolve('src/__tests__');

/** The helper itself is where the one safe invocation lives. */
const HELPER = join(TESTS, '__shared__', 'gitFixture.ts');

/** Any child-process call whose command is literally git. */
const SHELLS_OUT_TO_GIT = /\b(execFileSync|execSync|spawnSync|spawn|exec)\(\s*['"`]git['"`]/;

/** What a test writes above a spawn whose environment is its subject. */
const DELIBERATE = 'inherits-git-env: deliberate';

/** Any child-process call at all, whatever it runs. */
const SPAWNS_A_CHILD = /\b(execFileSync|execSync|spawnSync|spawn|exec)\(/;

/**
 * A file whose fixtures are checkouts, whether it reaches git itself or through
 * the helper. Taking only the first would shrink this guard's scope every time
 * a file was fixed, which is what let `runGuard` keep the hook's environment
 * after the `git` calls beside it were cleaned.
 */
const TOUCHES_GIT = (source: string) =>
  SHELLS_OUT_TO_GIT.test(source) || source.includes('__shared__/gitFixture');

function testFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return testFiles(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

/**
 * A call is safe when the environment it passes is built from `gitFreeEnv`.
 * Read on the same line or the three after it, which is where an options
 * object puts `env`.
 */
function unsafeGitCalls(source: string): string[] {
  const lines = source.split('\n');
  const found: string[] = [];
  for (const [index, line] of lines.entries()) {
    if (!SHELLS_OUT_TO_GIT.test(line)) continue;
    const window = lines.slice(index, index + 6).join('\n');
    if (window.includes('gitFreeEnv')) continue;
    found.push(line.trim());
  }
  return found;
}

/**
 * A file that calls git is one whose fixtures are checkouts, so the scripts it
 * spawns read git too. `restore-ios-turbomodule.sh` exited 128 under an
 * inherited `GIT_DIR` while this file's own calls were already clean.
 */
function unsafeChildSpawns(source: string): string[] {
  const lines = source.split('\n');
  const found: string[] = [];
  for (const [index, line] of lines.entries()) {
    if (!SPAWNS_A_CHILD.test(line)) continue;
    const window = lines.slice(index, index + 8).join('\n');
    if (window.includes('gitFreeEnv')) continue;
    // The one exemption, for a test whose subject is what a guard does under a
    // hostile environment and which therefore has to hand one over. Read above
    // the call as well, which is where a reason belongs.
    if (
      lines
        .slice(Math.max(0, index - 5), index + 8)
        .join('\n')
        .includes(DELIBERATE)
    )
      continue;
    found.push(line.trim());
  }
  return found;
}

describe('a test that shells out to git', () => {
  it('is something this guard can still find, or it is testing nothing', () => {
    const shelling = testFiles(TESTS).filter((file) =>
      SHELLS_OUT_TO_GIT.test(readFileSync(file, 'utf-8'))
    );

    expect(shelling.length).toBeGreaterThan(3);
  });

  it('passes the environment gitFreeEnv builds, so it cannot reach the real index', () => {
    const offenders: string[] = [];
    for (const file of testFiles(TESTS)) {
      if (file === HELPER) continue;
      const unsafe = unsafeGitCalls(readFileSync(file, 'utf-8'));
      for (const call of unsafe) offenders.push(`${relative(TESTS, file)}: ${call}`);
    }

    expect(offenders).toEqual([]);
  });

  it('cleans it for the scripts it spawns too, which read git themselves', () => {
    const offenders: string[] = [];
    for (const file of testFiles(TESTS)) {
      if (file === HELPER) continue;
      const source = readFileSync(file, 'utf-8');
      if (!TOUCHES_GIT(source)) continue;
      for (const call of unsafeChildSpawns(source)) {
        offenders.push(`${relative(TESTS, file)}: ${call}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe('the spawn check', () => {
  it('reports a spawn handed an environment built above it from the inherited one', () => {
    const source = [
      'const clean = { ...process.env };',
      'delete clean.VELOQ_MERGE_BASE;',
      "execFileSync('bash', [GUARD, '--merge'], { cwd: root, env: { ...clean, ...env } });",
    ].join('\n');

    expect(unsafeChildSpawns(source)).toHaveLength(1);
  });

  it('passes a spawn whose environment gitFreeEnv builds at the call', () => {
    const source = [
      'const inherited = { ...process.env };',
      'delete inherited.VELOQ_MERGE_BASE;',
      "execFileSync('bash', [GUARD, '--merge'], { cwd: root, env: { ...gitFreeEnv(inherited) } });",
    ].join('\n');

    expect(unsafeChildSpawns(source)).toEqual([]);
  });
});
