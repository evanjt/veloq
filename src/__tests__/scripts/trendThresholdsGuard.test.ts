/**
 * Scenario: the widget and the summary card each carried their own copy of the
 * five trend thresholds, so the same week read as up on one and flat on the
 * other.
 *
 * Expected behaviour: the guard fails a bare threshold handed to a trend call
 * and a trend call taken from anywhere but the shared module, leaves the shared
 * module and tests alone, and passes on this repository.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gitFreeEnv, initFixtureRepo } from '../__shared__/gitFixture';

const SCRIPT = join(__dirname, '../../../scripts/lint-trend-thresholds.mjs');

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'trend-thresholds-'));
  roots.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
  initFixtureRepo(root);
  return root;
}

function runGuard(root?: string): { status: number; output: string } {
  try {
    const output = execFileSync('node', root ? [SCRIPT, '--root', root] : [SCRIPT], {
      encoding: 'utf8',
      env: gitFreeEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

const SHARED = {
  'src/shared/format/trend.ts': [
    'export function trendDirection(a: number, b: number, deadband: number) {',
    '  return Math.abs(a - b) < deadband ? 0 : 1;',
    '}',
    'export const own = trendDirection(1, 2, 0.5);',
  ].join('\n'),
};

const IMPORT = "import { trendDirection, trendOfMetric } from '@/shared/format/trend';";

it('fails a bare threshold handed to a trend call', () => {
  const root = fixture({
    ...SHARED,
    'src/features/home/lib/widget.ts': [IMPORT, 'const d = trendDirection(a, b, 0.5);'].join('\n'),
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('src/features/home/lib/widget.ts:2');
});

it('fails a threshold with no leading zero, and one handed to a local wrapper', () => {
  const root = fixture({
    ...SHARED,
    'src/features/home/hooks/card.ts': [
      IMPORT,
      'const x = trendDirection(a, b, .25);',
      'const y = trendOf(a, b, 0.1);',
    ].join('\n'),
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('src/features/home/hooks/card.ts:2');
  expect(output).toContain('src/features/home/hooks/card.ts:3');
});

it('fails a trend call whose function is not the shared one', () => {
  const root = fixture({
    ...SHARED,
    'src/features/stats/lib/weekly.ts': [
      "import { trendOfMetric } from './myTrend';",
      "const d = trendOfMetric('ftp', a, b);",
    ].join('\n'),
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('src/features/stats/lib/weekly.ts');
  expect(output).toMatch(/@\/shared\/format\/trend/);
});

it('passes a threshold taken from the table, and the shared module itself', () => {
  const root = fixture({
    ...SHARED,
    'src/features/home/lib/widget.ts': [
      IMPORT,
      "import { TREND_DEADBAND } from '@/shared/format/trend';",
      'const d = trendDirection(a, b, TREND_DEADBAND.weekHours);',
      "const e = trendOfMetric('ftp', a, b);",
    ].join('\n'),
    'src/__tests__/trend.test.ts': 'const d = trendDirection(a, b, 0.5);',
  });

  expect(runGuard(root).status).toBe(0);
});

it('refuses an empty listing rather than reporting it clean', () => {
  const root = mkdtempSync(join(tmpdir(), 'trend-thresholds-empty-'));
  roots.push(root);
  writeFileSync(join(root, 'README.md'), 'x\n');
  execFileSync('git', ['init', '-q'], { cwd: root, env: gitFreeEnv() });

  expect(runGuard(root).status).toBe(1);
});

it('passes on this repository', () => {
  const { status, output } = runGuard();
  expect(output).not.toContain('bare threshold');
  expect(status).toBe(0);
});
