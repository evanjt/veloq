/**
 * Scenario: a screen prints a missing figure as its own '-' or '--', which a
 * screen reader announces as "minus", and which disagrees with the mark the
 * rest of the app prints.
 *
 * Expected behaviour: the guard fails a bare hyphen literal wherever it becomes
 * the value shown, and passes a hyphen used as a separator, a comparison, a
 * call argument, a template literal, the owner of the mark and tests.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/lint-absent-mark.mjs');
const SCREEN = 'src/features/orchards/components/PearCard.tsx';
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function runGuard(files: Record<string, string>): { status: number; output: string } {
  const root = mkdtempSync(join(tmpdir(), 'absent-mark-'));
  roots.push(root);
  for (const [path, contents] of Object.entries(files)) {
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

const screen = (body: string) => `export function PearCard(p: Props) {\n${body}\n}\n`;

it.each([
  ['a JSX child fallback', "  return <Text>{p.weight ?? '-'}</Text>;"],
  ['a JSX conditional', "  return <Text>{p.weight != null ? p.weight : '--'}</Text>;"],
  ['a JSX attribute', "  return <Pill label={p.ripeness == null ? '--' : 'ripe'} />;"],
  ['a returned value', "  if (p.weight == null) return '-';\n  return String(p.weight);"],
  ['an object property', "  return { label: 'Weight', value: p.weight ?? '-' };"],
  ['a variable', "  const shown = p.weight || '--';\n  return shown;"],
  ['an arrow body', "  return p.pears.map((x) => (x.weight == null ? '-' : x.weight));"],
  ['JSX text', '  return <Text>--</Text>;'],
])('fails %s', (_, body) => {
  const { status, output } = runGuard({ [SCREEN]: screen(body) });

  expect(status).toBe(1);
  expect(output).toContain('PearCard.tsx:2');
});

it.each([
  ['a separator', "  return [p.a, p.b].join(' - ');"],
  ['a split', "  return p.day.split('-')[0];"],
  ['a comparison', "  return p.sign === '-' ? 'down' : 'up';"],
  ['a concatenation', "  return p.from + '-' + p.to;"],
  ['a sign in a template', "  return `${p.up ? '+' : '-'}${p.delta}`;"],
  ['a range between elements', '  return <Text>{p.from} - {p.to}</Text>;'],
])('passes %s', (_, body) => {
  const { status } = runGuard({ [SCREEN]: screen(body) });

  expect(status).toBe(0);
});

it('leaves the owner of the mark and tests alone', () => {
  const { status } = runGuard({
    'src/shared/format/absent.ts': "export const ABSENT = '--';\n",
    'src/__tests__/pearCard.test.tsx': screen("  return <Text>{p.weight ?? '-'}</Text>;"),
    [SCREEN]: 'export {};\n',
  });

  expect(status).toBe(0);
});

it('refuses a tree it could not read rather than reporting it clean', () => {
  const { status } = runGuard({ 'README.txt': 'nothing here\n' });

  expect(status).toBe(1);
});
