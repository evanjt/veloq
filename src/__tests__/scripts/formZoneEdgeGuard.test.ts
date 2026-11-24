/**
 * Scenario: the engine states each day's form, zone and text in the athlete's
 * unit and sends the edges between zones. A screen that holds the edges, or
 * zones and prints a form from loads, is a second judge that drifts.
 *
 * Expected behaviour: the guard fails a file naming the edge list, a comparison
 * against the lowest edge or one of the removed form helpers, passes a screen
 * that only renders what it is handed, and exempts tests and generated files.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/lint-form-zone-edges.mjs');
const SCREEN = 'src/features/orchards/components/CiderGauge.tsx';
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function runGuard(files: Record<string, string>): { status: number; output: string } {
  const root = mkdtempSync(join(tmpdir(), 'form-zone-edges-'));
  roots.push(root);
  for (const [path, contents] of Object.entries({ 'src/index.ts': 'export {};\n', ...files })) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), contents);
  }
  try {
    const output = execFileSync('node', [SCRIPT, '--root', root], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

describe('form zone edge guard', () => {
  it('passes a screen that renders what the engine states', () => {
    const result = runGuard({
      [SCREEN]: 'export const label = (day: { formText?: string }) => day.formText;\n',
    });
    expect(result.status).toBe(0);
  });

  it.each([
    ['the edge list', 'const EDGES = [-30, -10, 5, 25];\n'],
    ['a comparison against the lowest edge', "if (value < -30) return 'low';\n"],
    ['a removed helper', 'const zone = getFormZone(tsb, fitness, asPercent);\n'],
    ['a removed rounding helper', 'const form = formFromLoads(ctl, atl);\n'],
  ])('fails %s in a screen', (_name, line) => {
    const result = runGuard({ [SCREEN]: line });
    expect(result.status).toBe(1);
    expect(result.output).toContain(`${SCREEN}:1`);
  });

  it('exempts tests and generated bindings', () => {
    const result = runGuard({
      'src/__tests__/lib/gauge.test.ts': 'const EDGES = [-30, -10, 5, 25];\n',
      'src/features/orchards/hooks/__tests__/gauge.test.ts': 'const EDGES = [-30, -10, 5, 25];\n',
      'modules/veloqrs/src/generated/veloqrs.ts': 'const EDGES = [-30, -10, 5, 25];\n',
    });
    expect(result.status).toBe(0);
  });
});
