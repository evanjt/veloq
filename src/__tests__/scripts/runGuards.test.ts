/**
 * Scenario: 39 guards ran one after another behind their own `npm run`, 22 s of
 * every commit, and several could no longer say what they protected.
 * Expected behaviour: one runner holds every guard with the regression it
 * catches, runs them together, fails when any fails, and stays in step with the
 * package.json script of the same name.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../..');

type Guard = { name: string; kind: string; cmd: string[]; catches: string };
const RUNNER = join(ROOT, 'scripts/run-guards.mjs');

function runner(...args: string[]): { status: number; output: string } {
  const r = spawnSync('node', [RUNNER, ...args], { cwd: ROOT, encoding: 'utf8' });
  return { status: r.status ?? -1, output: `${r.stdout}${r.stderr}` };
}

const GUARDS = JSON.parse(runner('--set', 'all', '--json').output) as Guard[];

const scripts = (
  JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  }
).scripts;

/** Guard-shaped scripts that are run somewhere other than the gates, and where. */
const NOT_GATES: Record<string, string> = {
  'lint-android-bundle.mjs': 'check:android-bundle, before a device build is trusted',
  'lint-native-record-shapes.mjs': 'check:native-records, after every android:debug build',
  'check-rust-coverage.mjs': 'the Rust Coverage workflow',
};

describe('every guard', () => {
  it.each(GUARDS.map((g) => [g.name, g] as const))('%s names what it catches', (_name, g) => {
    expect(['correctness', 'style', 'environment']).toContain(g.kind);
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
    const registered = GUARDS.flatMap((g) => g.cmd).filter((part) => part.startsWith('scripts/'));
    const viaNpm = GUARDS.filter((g) => g.cmd[0] === 'npm').map((g) => scripts[g.name] ?? '');
    const missing = readdirSync(join(ROOT, 'scripts'))
      .filter((f) => /^(lint|check)-.*\.mjs$/.test(f))
      .filter((f) => !registered.includes(`scripts/${f}`))
      .filter((f) => !viaNpm.some((cmd) => cmd.includes(`scripts/${f}`)))
      .filter((f) => !(f in NOT_GATES));
    expect(missing).toEqual([]);
  });
});

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
      return runner('--set', 'all', '--guards', file);
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

  it('runs only the correctness guards for a commit', () => {
    const style: Guard = { ...guard('style-one', 'exit 1'), kind: 'style' };
    const dir = mkdtempSync(join(tmpdir(), 'run-guards-'));
    try {
      const file = join(dir, 'guards.json');
      writeFileSync(file, JSON.stringify([guard('correct', 'exit 0'), style]));
      expect(runner('--set', 'commit', '--guards', file).status).toBe(0);
      expect(runner('--set', 'land', '--guards', file).status).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a set it does not know', () => {
    expect(runner('--set', 'everything').status).toBe(2);
  });
});
