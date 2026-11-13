/**
 * Scenario: a landing that changes only documentation re-runs guards that judge the engine's
 * generated surface.
 * Expected behaviour: a guard carrying `paths` is skipped when the landed range touches none of
 * them, runs when it touches one, and runs whenever the range is unknown.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { gitFreeEnv, initFixtureRepo, runGit } from '../__shared__/gitFixture';

const ROOT = resolve(__dirname, '../../..');
const RUNNER = join(ROOT, 'scripts/run-guards.mjs');
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

type Guard = { name: string; kind: string; paths?: string[] };

const PLANNER = JSON.stringify(join(ROOT, 'scripts/lib/guardPaths.mjs'));
const PLAN_SCRIPT = `import { planGuards } from ${PLANNER};
const [guards, changed] = JSON.parse(process.argv[1]);
console.log(JSON.stringify(planGuards(guards, changed)));`;

const loadPlanner = async () => ({
  planGuards: (guards: Guard[], changed: string[] | null) => {
    const args = ['--input-type=module', '-e', PLAN_SCRIPT, JSON.stringify([guards, changed])];
    const r = spawnSync(process.execPath, args, { env: gitFreeEnv(), encoding: 'utf8' });
    return JSON.parse(r.stdout) as { run: Guard[]; skipped: Guard[] };
  },
});

describe('planGuards', () => {
  const scoped = { name: 'a', kind: 'correctness', paths: ['kiln/', 'glaze/'] };
  const whole = { name: 'b', kind: 'correctness' };

  it('skips a scoped guard when no changed file is under its paths', async () => {
    const { planGuards } = await loadPlanner();
    const plan = planGuards([scoped, whole], ['docs/x.md']);
    expect(plan.run).toEqual([whole]);
    expect(plan.skipped).toEqual([scoped]);
  });

  it('runs a scoped guard when one changed file is under a path', async () => {
    const { planGuards } = await loadPlanner();
    expect(planGuards([scoped], ['docs/x.md', 'glaze/y.rs']).run).toEqual([scoped]);
  });

  it('matches a prefix and not a longer sibling name', async () => {
    const { planGuards } = await loadPlanner();
    expect(planGuards([scoped], ['kiln-extra/y.rs']).skipped).toEqual([scoped]);
  });

  it('runs every guard when the range is unknown', async () => {
    const { planGuards } = await loadPlanner();
    expect(planGuards([scoped, whole], null).run).toEqual([scoped, whole]);
  });

  it('skips a scoped guard when the range is empty', async () => {
    const { planGuards } = await loadPlanner();
    expect(planGuards([scoped], []).skipped).toEqual([scoped]);
  });
});

describe('run-guards at the land gate', () => {
  function fixture() {
    const base = mkdtempSync(join(tmpdir(), 'guards-paths-'));
    roots.push(base);
    const root = join(base, 'repo');
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'docs', 'a.md'), 'a\n');
    initFixtureRepo(root);
    runGit(['commit', '-q', '-m', 'base'], root);
    const marker = join(base, 'ran');
    const guards = join(base, 'guards.json');
    writeFileSync(
      guards,
      JSON.stringify([
        {
          name: 'fixture:scoped',
          kind: 'correctness',
          paths: ['kiln/'],
          cmd: ['touch', marker],
          catches: 'a stand-in guard',
        },
      ])
    );
    return { root, guards, marker };
  }

  function run(root: string, guards: string, set: string, mergeBase?: string) {
    const r = spawnSync(process.execPath, [RUNNER, '--set', set, '--guards', guards], {
      env: { ...gitFreeEnv(), ...(mergeBase ? { VELOQ_MERGE_BASE: mergeBase } : {}) },
      cwd: root,
      encoding: 'utf8',
    });
    return { status: r.status, output: `${r.stdout}${r.stderr}` };
  }

  function commitFile(root: string, file: string) {
    mkdirSync(join(root, file, '..'), { recursive: true });
    writeFileSync(join(root, file), 'x\n');
    runGit(['add', file], root);
    runGit(['commit', '-m', 'change'], root);
  }

  it('skips the command for a range touching only documentation', () => {
    const { root, guards, marker } = fixture();
    const base = runGit(['rev-parse', 'HEAD'], root).trim();
    commitFile(root, 'docs/x.md');

    const result = run(root, guards, 'land', base);

    expect(result.status).toBe(0);
    expect(existsSync(marker)).toBe(false);
    expect(result.output).toContain('fixture:scoped');
    expect(result.output).toContain('skipped');
  });

  it('runs the command when the range touches its paths', () => {
    const { root, guards, marker } = fixture();
    const base = runGit(['rev-parse', 'HEAD'], root).trim();
    commitFile(root, 'kiln/x.rs');

    expect(run(root, guards, 'land', base).status).toBe(0);
    expect(existsSync(marker)).toBe(true);
  });

  it('runs the command with no merge base', () => {
    const { root, guards, marker } = fixture();
    commitFile(root, 'docs/x.md');

    expect(run(root, guards, 'land').status).toBe(0);
    expect(existsSync(marker)).toBe(true);
  });

  it('runs the command under the all set whatever the range', () => {
    const { root, guards, marker } = fixture();
    const base = runGit(['rev-parse', 'HEAD'], root).trim();
    commitFile(root, 'docs/x.md');

    expect(run(root, guards, 'all', base).status).toBe(0);
    expect(existsSync(marker)).toBe(true);
  });

  it('runs the command when the base ref does not exist', () => {
    const { root, guards, marker } = fixture();

    const result = run(root, guards, 'land', 'no-such-branch');

    expect(result.status).toBe(0);
    expect(existsSync(marker)).toBe(true);
  });
});

describe('the guard list', () => {
  it('scopes only the five engine-surface guards', () => {
    const r = spawnSync(process.execPath, [RUNNER, '--json', '--set', 'all'], {
      cwd: tmpdir(),
      encoding: 'utf8',
      env: gitFreeEnv(),
    });
    const scoped = (JSON.parse(r.stdout) as { name: string; paths?: string[] }[])
      .filter((g) => g.paths)
      .map((g) => g.name)
      .sort();
    expect(scoped).toEqual([
      'check:bindings-fresh',
      'ffi:client-reach',
      'ffi:orphans:check',
      'ffi:reach',
      'lint:engine-surface',
    ]);
  });
});
