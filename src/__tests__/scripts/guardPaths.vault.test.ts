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

const SCOPED_STYLE_GUARDS = [
  'check:apple-crypto',
  'check:style-owners',
  'check:tracematch-docs',
  'lint:bare-refresh-control',
  'lint:bare-spinner',
  'lint:button-row-siblings',
  'lint:chrome-glyphs',
  'lint:connect-page-titles',
  'lint:connect-theme-subset',
  'lint:dark-counterpart',
  'lint:disabled-ink-content',
  'lint:empty-state-styles',
  'lint:engine-client-forwards',
  'lint:exhaustive-deps-disables',
  'lint:feature-imports',
  'lint:floor-type-styles',
  'lint:font-size-pluck',
  'lint:ground-token-text',
  'lint:hand-rolled-buttons',
  'lint:haptics-owner',
  'lint:heading-tokens',
  'lint:hold-durations',
  'lint:icon-sizes',
  'lint:intervals-paths',
  'lint:intervals-source',
  'lint:light-only-roles',
  'lint:link-serialize',
  'lint:locale-capitals',
  'lint:locale-ellipsis',
  'lint:lone-spinner-in-padding',
  'lint:maestro-capture-debug',
  'lint:maestro-debug-switch',
  'lint:maestro-open-link',
  'lint:maestro-store-shots',
  'lint:maestro-strip-tap',
  'lint:mark-contrast',
  'lint:modal-sheets',
  'lint:native-header',
  'lint:paper-spinner',
  'lint:point-shape',
  'lint:press-feedback',
  'lint:question-titles',
  'lint:react-native-text',
  'lint:retired-names',
  'lint:rgba',
  'lint:roleless-pressables',
  'lint:row-chevrons',
  'lint:sentence-case',
  'lint:sheet-headers',
  'lint:single-line-text',
  'lint:style-alpha',
  'lint:style-badges',
  'lint:style-border-width',
  'lint:style-containers',
  'lint:style-font-family',
  'lint:style-font-style',
  'lint:style-font-weight',
  'lint:style-icon-size',
  'lint:style-letter-spacing',
  'lint:style-line-height',
  'lint:style-motion',
  'lint:style-opacity',
  'lint:style-shadow',
  'lint:style-status-tints',
  'lint:style-stroke-width',
  'lint:style-theme-imports',
  'lint:style-z-index',
  'lint:switch-owner',
  'lint:tap-targets',
  'lint:verdict-palette',
  'lint:window-dimensions',
];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

type Guard = { name: string; kind: string; paths?: string[]; catches?: string };

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
  it('scopes exactly the guards listed here, each to the paths it reads', () => {
    const r = spawnSync(process.execPath, [RUNNER, '--json', '--set', 'all'], {
      cwd: tmpdir(),
      encoding: 'utf8',
      env: gitFreeEnv(),
    });
    const scoped = (JSON.parse(r.stdout) as { name: string; paths?: string[] }[])
      .filter((g) => g.paths)
      .map((g) => g.name)
      .sort();
    expect(scoped).toEqual(
      [
        'check:bindings-fresh',
        'check:export-compliance',
        'ffi:client-reach',
        'ffi:orphans:check',
        'ffi:reach',
        'lint:connect-bare-controls',
        'lint:connect-contrast',
        'lint:connect-css',
        'lint:connect-css-elements',
        'lint:engine-surface',
        ...SCOPED_STYLE_GUARDS,
      ].sort()
    );
  });

  it('leaves only whole-tree style, build and environment guards running on a documentation landing', async () => {
    const r = spawnSync(process.execPath, [RUNNER, '--json', '--set', 'land'], {
      cwd: tmpdir(),
      encoding: 'utf8',
      env: gitFreeEnv(),
    });
    const { planGuards } = await loadPlanner();
    const { run } = planGuards(JSON.parse(r.stdout) as Guard[], ['docs/x.md']);
    const unmarked = run
      .filter((g) => ['style', 'build', 'environment'].includes(g.kind))
      .filter((g) => !/reads the whole tree/i.test(g.catches ?? ''))
      .map((g) => g.name);
    expect(unmarked).toEqual([]);
  });
});
