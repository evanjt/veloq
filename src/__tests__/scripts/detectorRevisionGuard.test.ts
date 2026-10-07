/**
 * Scenario: the bitwise golden lives in the tracematch submodule and
 * `DETECTOR_REVISION` lives in veloqrs. A tracematch pointer bump that moves
 * the golden changes what the detector cuts, and unless the revision moves in
 * the same commit, upgraded installs adopt the evidence cache the old detector
 * wrote.
 *
 * Expected behaviour: the guard fails when the staged pointer differs from the
 * one in `HEAD`, the golden differs between the two commits, and the staged
 * `DETECTOR_REVISION` equals the one in `HEAD`. A moved pointer with an
 * unchanged golden, a bumped revision, an unmoved pointer, or a commit this
 * clone does not hold all pass.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runGit, gitFreeEnv } from '../__shared__/gitFixture';

const SCRIPT = join(__dirname, '../../../scripts/lint-detector-revision.mjs');
const SUB = 'modules/veloqrs/rust/tracematch';
const GOLDEN = 'tests/fixtures/geolife_bitwise_golden.txt';
const REVISION_FILE = 'modules/veloqrs/rust/veloqrs/src/persistence/sections/mod.rs';

const roots: string[] = [];

function runGuard(root: string): { status: number; output: string } {
  try {
    const output = execFileSync('node', [SCRIPT, '--root', root], {
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

function commit(cwd: string, message: string): string {
  runGit(['-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', message], cwd);
  return runGit(['rev-parse', 'HEAD'], cwd).trim();
}

/** A tracematch-shaped repository: its golden is `first`, then `second`. */
function submoduleRepo(
  first: string,
  second: string
): { path: string; older: string; newer: string } {
  const path = mkdtempSync(join(tmpdir(), 'detector-rev-sub-'));
  roots.push(path);
  runGit(['init', '-q', '-b', 'main'], path);
  mkdirSync(join(path, 'tests/fixtures'), { recursive: true });
  writeFileSync(join(path, GOLDEN), first);
  runGit(['add', GOLDEN], path);
  const older = commit(path, 'one');
  writeFileSync(join(path, GOLDEN), second);
  runGit(['add', GOLDEN], path);
  const newer = commit(path, 'two');
  return { path, older, newer };
}

function revisionSource(revision: number): string {
  return `pub const DETECTOR_REVISION: u32 = ${revision};\n`;
}

/** A superproject recording `older`, with the newer pointer and revision staged. */
function superproject(
  sub: { path: string; older: string; newer: string },
  opts: { stagedPointer: string; stagedRevision: number; cloneFrom?: string }
): string {
  const root = mkdtempSync(join(tmpdir(), 'detector-rev-super-'));
  roots.push(root);
  runGit(['init', '-q', '-b', 'main'], root);
  mkdirSync(join(root, REVISION_FILE, '..'), { recursive: true });
  writeFileSync(join(root, REVISION_FILE), revisionSource(0));
  runGit(['add', REVISION_FILE], root);
  runGit(['update-index', '--add', '--cacheinfo', `160000,${sub.older},${SUB}`], root);
  commit(root, 'record the pointer');
  runGit(['clone', '-q', '--no-checkout', opts.cloneFrom ?? sub.path, SUB], root);
  writeFileSync(join(root, REVISION_FILE), revisionSource(opts.stagedRevision));
  runGit(['add', REVISION_FILE], root);
  runGit(['update-index', '--cacheinfo', `160000,${opts.stagedPointer},${SUB}`], root);
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

it('fails when the golden moved with the pointer and the revision did not', () => {
  const sub = submoduleRepo('a\n', 'b\n');
  const { status, output } = runGuard(
    superproject(sub, { stagedPointer: sub.newer, stagedRevision: 0 })
  );
  expect(status).toBe(1);
  expect(output).toContain('DETECTOR_REVISION');
  expect(output).toContain(sub.newer.slice(0, 7));
});

it('passes when the revision was bumped with the golden', () => {
  const sub = submoduleRepo('a\n', 'b\n');
  expect(runGuard(superproject(sub, { stagedPointer: sub.newer, stagedRevision: 1 })).status).toBe(
    0
  );
});

it('passes when the pointer moved and the golden did not', () => {
  const sub = submoduleRepo('a\n', 'a\n');
  expect(runGuard(superproject(sub, { stagedPointer: sub.newer, stagedRevision: 0 })).status).toBe(
    0
  );
});

it('passes when the pointer did not move', () => {
  const sub = submoduleRepo('a\n', 'b\n');
  expect(runGuard(superproject(sub, { stagedPointer: sub.older, stagedRevision: 0 })).status).toBe(
    0
  );
});

it('passes, naming what it could not compare, when the new commit is not in the clone', () => {
  const sub = submoduleRepo('a\n', 'b\n');
  // The clone comes from a repository that holds neither staged commit.
  const stranger = submoduleRepo('x\n', 'y\n');
  const root = superproject(sub, {
    stagedPointer: sub.newer,
    stagedRevision: 0,
    cloneFrom: stranger.path,
  });
  const { status, output } = runGuard(root);
  expect(status).toBe(0);
  expect(output).toContain('not compared');
});
