/**
 * Scenario: a fill-only token (`colors.success`, `colors.warning`) reached a
 * mark through a local, a record entry or a prop other than `color`, so the
 * same-line check never saw it.
 *
 * Expected behaviour: a fill token routed through a local or a record and
 * then drawn as a `color`, `iconColor` or `tint` fails the guard, and the same
 * token used only as a ground does not.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/lint-mark-contrast.mjs');

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function runOn(
  source: string,
  file = 'src/features/x/Mark.tsx'
): { status: number; output: string } {
  const root = mkdtempSync(join(tmpdir(), 'mark-contrast-'));
  roots.push(root);
  const full = join(root, file);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, source);
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

it('fails a fill token held in a local and drawn as a text colour', () => {
  const { status, output } = runOn(
    [
      'const statusColor = connected ? colors.success : colors.warning;',
      'const a = <Text style={{ color: statusColor }}>x</Text>;',
      '',
    ].join('\n')
  );

  expect(status).toBe(1);
  expect(output).toContain('Mark.tsx:2');
});

it('fails a fill token held in a record and read into a mark', () => {
  const { status, output } = runOn(
    [
      'const LEVELS = {',
      '  ok: colors.success,',
      '  warn: colors.warning,',
      '};',
      'const color = LEVELS[level];',
      'const a = <Icon name="x" color={color} />;',
      '',
    ].join('\n')
  );

  expect(status).toBe(1);
  expect(output).toContain('Mark.tsx:6');
});

it('fails a fill token passed as iconColor', () => {
  const { status, output } = runOn(
    ['const tone = colors.warning;', '<IconButton iconColor={tone} />;', ''].join('\n')
  );

  expect(status).toBe(1);
  expect(output).toContain('Mark.tsx:2');
});

it('leaves a fill token used only as a ground alone', () => {
  const { status } = runOn(
    [
      'const ground = colors.success;',
      'const a = <View style={{ backgroundColor: ground }} />;',
      '',
    ].join('\n')
  );

  expect(status).toBe(0);
});

it('checks the sport filter chips like any other file', () => {
  const { status, output } = runOn(
    'const a = <Text style={{ color: colors.success }}>x</Text>;\n',
    'src/features/maps/components/ActivityTypeFilter.tsx'
  );

  expect(status).toBe(1);
  expect(output).toContain('ActivityTypeFilter.tsx:1');
});
