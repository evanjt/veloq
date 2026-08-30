/**
 * Scenario: two file headers grew into design diaries, and every line number
 * and line count they cited had drifted by 30 to 200 per cent.
 *
 * Expected behaviour: the guard fails on a comment that cites one, so the
 * diaries cannot grow back, and a clean tree exits 0.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/lint-comment-line-refs.mjs');

function runGuard(root?: string): { status: number; output: string } {
  try {
    const output = execFileSync('node', root ? [SCRIPT, '--root', root] : [SCRIPT], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

const roots: string[] = [];

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'line-refs-'));
  roots.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', '-A'], { cwd: root });
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

it('exits 0 on this repo, so the audit gate stays usable', () => {
  expect(runGuard().status).toBe(0);
});

it('fails on a cited line range', () => {
  const root = fixture({
    'src/a.ts': ' * 1. Training load (lines 62-130):\nexport const a = 1;\n',
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('src/a.ts:1');
});

it('fails on a cited line count', () => {
  const root = fixture({
    'src/b.ts': '// useGpsDataFetcher.ts (270 lines)\nexport const b = 1;\n',
  });

  expect(runGuard(root).status).toBe(1);
});

it('fails on a single cited line', () => {
  const root = fixture({ 'src/c.ts': '// wind threshold (line 246)\nexport const c = 1;\n' });

  expect(runGuard(root).status).toBe(1);
});

it('leaves code alone, only comments are read', () => {
  const root = fixture({ 'src/d.ts': "export const label = 'lines 62-130';\n" });

  expect(runGuard(root).status).toBe(0);
});

it('leaves a test file alone, a fixture may quote one', () => {
  const root = fixture({
    'src/__tests__/e.test.ts': '// the header used to say (lines 1-133)\nit.todo("x");\n',
  });

  expect(runGuard(root).status).toBe(0);
});

it('passes prose that mentions lines without a number', () => {
  const root = fixture({ 'src/f.ts': '// Drawn as lines on the map.\nexport const f = 1;\n' });

  expect(runGuard(root).status).toBe(0);
});
