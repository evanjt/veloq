/**
 * Scenario: a screen prints a value with `toFixed`, which always writes a
 * period decimal and no grouping, so it reads '12.5' beside a date and a
 * '0,82' written in the app's language.
 *
 * Expected behaviour: the guard fails a `toFixed` outside the shared
 * formatters, names the file and line, and accepts the formatters themselves,
 * tests, debug screens, log lines and the listed values that are not read.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gitFreeEnv, initFixtureRepo } from '../__shared__/gitFixture';

const SCRIPT = join(__dirname, '../../../scripts/lint-rendered-decimals.mjs');

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'rendered-decimals-'));
  roots.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
  initFixtureRepo(root);
  return root;
}

function runGuard(root: string): { status: number; output: string } {
  try {
    const output = execFileSync('node', [SCRIPT, '--root', root], {
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

it('fails a value printed with toFixed on a screen', () => {
  const root = fixture({
    'src/features/kiln/Glaze.tsx': 'const a = 1;\nconst text = `${depth.toFixed(1)} mm`;\n',
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('src/features/kiln/Glaze.tsx:2');
});

it('fails a toFixed on an expression in brackets', () => {
  const root = fixture({
    'src/features/kiln/Firing.tsx': 'const text = `${(seconds / 60).toFixed(1)} min`;\n',
  });

  expect(runGuard(root).status).toBe(1);
});

it('accepts the shared formatters, tests and debug screens', () => {
  const root = fixture({
    'src/shared/format/clay.ts': 'export const f = (v: number) => v.toFixed(1);\n',
    'src/__tests__/kiln.test.ts': 'expect((1.25).toFixed(1)).toBe("1.3");\n',
    'src/features/kiln/KilnDebugPanel.tsx': 'const text = `${temp.toFixed(0)} C`;\n',
    'src/app/debug.tsx': 'const heap = (bytes / 1024).toFixed(1);\n',
  });

  expect(runGuard(root).status).toBe(0);
});

it('accepts a toFixed inside a log call', () => {
  const root = fixture({
    'src/features/kiln/useKiln.ts':
      'log.log(\n  `fired in ${ms.toFixed(0)}ms`\n);\nconsole.warn(`${ms.toFixed(1)}`);\n',
  });

  expect(runGuard(root).status).toBe(0);
});

it('fails a toFixed after a log call has closed', () => {
  const root = fixture({
    'src/features/kiln/useKiln.ts': 'log.log(`fired`);\nconst text = `${ms.toFixed(0)} ms`;\n',
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('src/features/kiln/useKiln.ts:2');
});
