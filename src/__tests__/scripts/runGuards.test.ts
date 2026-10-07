/**
 * Scenario: 39 guards ran one after another behind their own `npm run`, 22 s of
 * every commit, and several could no longer say what they protected.
 * Expected behaviour: one runner holds every guard with the regression it
 * catches, runs them together, fails when any fails, and stays in step with the
 * package.json script of the same name.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { gitFreeEnv, initFixtureRepo } from '../__shared__/gitFixture';

const ROOT = resolve(__dirname, '../../..');

type Guard = { name: string; kind: string; cmd: string[]; catches: string };
const RUNNER = join(ROOT, 'scripts/run-guards.mjs');

function runner(...args: string[]): { status: number; output: string } {
  return runnerIn(ROOT, ...args);
}

function runnerIn(cwd: string, ...args: string[]): { status: number; output: string } {
  const r = spawnSync('node', [RUNNER, ...args], { cwd, encoding: 'utf8', env: gitFreeEnv() });
  return { status: r.status ?? -1, output: `${r.stdout}${r.stderr}` };
}

const GUARDS = JSON.parse(runner('--set', 'all', '--json').output) as Guard[];

const scripts = (
  JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  }
).scripts;

/** Guard-shaped scripts that are run somewhere other than the runner, and where. */
const NOT_GATES: Record<string, string> = {
  'check-native-tree.mjs': 'the native build scripts and bundle:android, before each starts',
  'check-toolchain.mjs': 'the android and ios build scripts, before each starts',
  'lint-android-bundle.mjs': 'check:android-bundle, before a device build is trusted',
  'lint-native-record-shapes.mjs': 'check:native-records, after every android:debug build',
  'check-rust-coverage.mjs': 'the Rust Coverage workflow',
  'lint-empty-test-binaries.js':
    'the CI Rust job, since it reads `cargo nextest list` and that needs the test build',
  'check-rust-fmt.ts': 'the pre-commit rustfmt gate, over the staged Rust',
  'check-rust-tests.ts': 'the pre-commit rusttests gate, which builds the staged test tree',
  'check-commit-index.sh': 'pre-commit and pre-merge-commit, before any other gate',
  'check-merge-format.sh': 'the pre-commit audit gate and merge-gates.sh, over the merged tree',
  'check-merge-lint.sh': 'merge-gates.sh, over the merged tree',
  'check-merge-message.sh': 'commit-msg, while a merge is in progress',
  'check-merge-tests.sh': 'merge-gates.sh, to pick the suites a merge touched',
  'check-retired-history.sh':
    'land-branch.sh and the merge hooks, with the target and the incoming branch as arguments',
  'check-staged-tree.sh': 'pre-commit, before and after the gates run',
};

/** Every script shaped like a guard, whatever it is written in. */
const GUARD_SCRIPT = /^(lint|check)-.*\.(mjs|js|ts|sh)$/;

/**
 * The guard scripts in `files` that the runner does not run, no npm script it
 * runs through reaches, and NOT_GATES does not account for.
 */
function unaccounted(
  files: string[],
  guards: Guard[],
  npmScripts: Record<string, string>,
  notGates: Record<string, string>
): string[] {
  const registered = guards.flatMap((g) => g.cmd).filter((part) => part.startsWith('scripts/'));
  const viaNpm = guards.filter((g) => g.cmd[0] === 'npm').map((g) => npmScripts[g.name] ?? '');
  return files
    .filter((f) => GUARD_SCRIPT.test(f))
    .filter((f) => !registered.includes(`scripts/${f}`))
    .filter((f) => !viaNpm.some((cmd) => cmd.includes(`scripts/${f}`)))
    .filter((f) => !(f in notGates));
}

describe('every guard', () => {
  it.each(GUARDS.map((g) => [g.name, g] as const))('%s names what it catches', (_name, g) => {
    expect(['correctness', 'style', 'environment', 'build']).toContain(g.kind);
    expect(g.catches.trim().length).toBeGreaterThan(20);
  });

  it('has a unique name', () => {
    const names = GUARDS.map((g) => g.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(GUARDS.map((g) => [g.name, g] as const))(
    '%s runs what its package.json script runs',
    (name, g) => {
      const command = g.cmd.join(' ');
      if (command === `npm run --silent ${name}`) return;
      expect(scripts[name]).toBe(command);
    }
  );

  it('covers every guard script under scripts/, or says where it runs instead', () => {
    expect(unaccounted(readdirSync(join(ROOT, 'scripts')), GUARDS, scripts, NOT_GATES)).toEqual([]);
  });

  it('names a script NOT_GATES lists only while the script exists', () => {
    const present = new Set(readdirSync(join(ROOT, 'scripts')));
    expect(Object.keys(NOT_GATES).filter((f) => !present.has(f))).toEqual([]);
  });
});

describe('the coverage check', () => {
  const registered: Guard = {
    name: 'lint:known',
    kind: 'style',
    cmd: ['node', 'scripts/lint-known.mjs'],
    catches: 'a stand-in guard for the coverage check',
  };

  it.each(['lint-foo.mjs', 'lint-foo.js', 'check-foo.ts', 'check-foo.sh'])(
    'refuses a guard script wired nowhere: %s',
    (file) => {
      expect(unaccounted(['lint-known.mjs', file, 'README.md'], [registered], {}, {})).toEqual([
        file,
      ]);
    }
  );

  it('passes one reached through the npm script a guard runs', () => {
    const viaNpm: Guard = { ...registered, name: 'lint:npm', cmd: ['npm', 'run', 'lint:npm'] };

    expect(
      unaccounted(['check-foo.ts'], [viaNpm], { 'lint:npm': 'npx tsx scripts/check-foo.ts' }, {})
    ).toEqual([]);
  });

  it('passes one NOT_GATES says runs somewhere else', () => {
    expect(unaccounted(['check-foo.sh'], [], {}, { 'check-foo.sh': 'a hook' })).toEqual([]);
  });

  it('leaves alone a script that is not shaped like a guard', () => {
    expect(unaccounted(['merge-gates.sh', 'lint-foo.json'], [], {}, {})).toEqual([]);
  });
});

/** A clean repository, since `--set all` refuses a tree holding unstaged work. */
function cleanRepo(dir: string): string {
  const root = join(dir, 'repo');
  mkdirSync(root);
  writeFileSync(join(root, 'tracked.txt'), 'base\n');
  initFixtureRepo(root);
  return root;
}

describe('the runner', () => {
  const guard = (name: string, script: string): Guard => ({
    name,
    kind: 'correctness',
    cmd: ['sh', '-c', script],
    catches: 'a stand-in failure for the runner test',
  });

  function withGuards(guards: Guard[]): { status: number; output: string } {
    const dir = mkdtempSync(join(tmpdir(), 'run-guards-'));
    try {
      const file = join(dir, 'guards.json');
      writeFileSync(file, JSON.stringify(guards));
      return runnerIn(cleanRepo(dir), '--set', 'all', '--guards', file);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('passes when every guard passes', () => {
    const { status, output } = withGuards([guard('a', 'exit 0'), guard('b', 'exit 0')]);
    expect(status).toBe(0);
    expect(output).toContain('2 all guards passed');
  });

  it('fails when any guard fails, names it and prints its output', () => {
    const { status, output } = withGuards([
      guard('passes', 'exit 0'),
      guard('fails', 'echo broke; exit 3'),
      guard('also', 'exit 0'),
    ]);
    expect(status).toBe(1);
    expect(output).toContain('--- fails failed');
    expect(output).toContain('broke');
    expect(output).not.toContain('--- passes failed');
    expect(output).toContain('1 of 3 all guards failed');
  });

  it.each(['style', 'environment', 'build'])(
    'runs %s guards at land and in CI but not at commit',
    (kind) => {
      const deferred: Guard = { ...guard('deferred', 'exit 1'), kind };
      const dir = mkdtempSync(join(tmpdir(), 'run-guards-'));
      try {
        const file = join(dir, 'guards.json');
        writeFileSync(file, JSON.stringify([guard('correct', 'exit 0'), deferred]));
        expect(runner('--set', 'commit', '--guards', file).status).toBe(0);
        expect(runner('--set', 'land', '--guards', file).status).toBe(1);
        expect(runnerIn(cleanRepo(dir), '--set', 'all', '--guards', file).status).toBe(1);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  );

  it('refuses a set it does not know', () => {
    expect(runner('--set', 'everything', '--list').status).toBe(2);
  });
});
