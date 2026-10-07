/**
 * Scenario: the whole-tree guards read the index, so a build left unstaged is
 * judged as its base and passes.
 * Expected behaviour: `--set all` refuses an unstaged edit or an untracked file
 * and names it. The same changes staged reach the guards, and the hook sets
 * judge the index without refusing.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { gitFreeEnv, initFixtureRepo, runGit } from '../__shared__/gitFixture';

const ROOT = resolve(__dirname, '../../..');
const RUNNER = join(ROOT, 'scripts/run-guards.mjs');
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function fixture(): { root: string; guards: string } {
  const base = mkdtempSync(join(tmpdir(), 'guards-unstaged-'));
  roots.push(base);
  const root = join(base, 'repo');
  mkdirSync(root);
  writeFileSync(join(root, 'tracked.txt'), 'base\n');
  initFixtureRepo(root);
  const guards = join(base, 'guards.json');
  writeFileSync(
    guards,
    JSON.stringify([
      { name: 'fixture:ok', kind: 'correctness', cmd: ['true'], catches: 'a stand-in guard' },
    ])
  );
  return { root, guards };
}

function run(root: string, guards: string, set: string) {
  const r = spawnSync(process.execPath, [RUNNER, '--set', set, '--guards', guards], {
    cwd: root,
    encoding: 'utf8',
    env: gitFreeEnv(),
  });
  return { status: r.status, output: `${r.stdout}${r.stderr}` };
}

describe('--set all with work the index does not hold', () => {
  it('refuses an unstaged edit and names the path', () => {
    const { root, guards } = fixture();
    writeFileSync(join(root, 'tracked.txt'), 'edited\n');

    const result = run(root, guards, 'all');

    expect(result.status).toBe(1);
    expect(result.output).toContain('tracked.txt');
    expect(result.output).toContain('git add');
  });

  it('refuses an untracked file', () => {
    const { root, guards } = fixture();
    writeFileSync(join(root, 'new.txt'), 'new\n');

    const result = run(root, guards, 'all');

    expect(result.status).toBe(1);
    expect(result.output).toContain('new.txt');
  });

  it('passes the same changes through once staged', () => {
    const { root, guards } = fixture();
    writeFileSync(join(root, 'tracked.txt'), 'edited\n');
    writeFileSync(join(root, 'new.txt'), 'new\n');
    runGit(['add', 'tracked.txt', 'new.txt'], root);

    expect(run(root, guards, 'all').status).toBe(0);
  });

  it('passes a clean tree', () => {
    const { root, guards } = fixture();

    expect(run(root, guards, 'all').status).toBe(0);
  });
});

describe('the hook sets', () => {
  it.each(['commit', 'land'])('judge the index in %s without refusing the disk', (set) => {
    const { root, guards } = fixture();
    writeFileSync(join(root, 'tracked.txt'), 'edited\n');
    writeFileSync(join(root, 'new.txt'), 'new\n');

    expect(run(root, guards, set).status).toBe(0);
  });
});
