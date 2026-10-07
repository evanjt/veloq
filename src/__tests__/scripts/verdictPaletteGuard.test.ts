/**
 * Scenario: the period comparison sheet coloured its change `colors.success`
 * when the string started with '+' and `colors.warning` otherwise, outside the
 * verdict ladder, so load drew green and amber where the polarity table says
 * it has no judgement. The guard only matched `insightIcon` and `statusBadge`,
 * so this passed it.
 *
 * Expected behaviour: anywhere in src, a raw success, warning
 * or error colour picked by a comparison fails the guard, and the same colour
 * used as a fixed token does not.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/lint-verdict-palette.mjs');

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'verdict-palette-'));
  roots.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

function runGuard(root: string): { status: number; output: string } {
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

const SHEET = 'src/features/insights/components/content/Sheet.tsx';

it('fails a success or warning colour picked by a ternary on one line', () => {
  const root = fixture({
    [SHEET]: 'const c = isPositive ? colors.success : colors.warning;\n',
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain(`${SHEET}:1`);
});

it('fails a ternary laid out over several lines', () => {
  const root = fixture({
    [SHEET]: [
      'const c =',
      '  metric == null',
      '    ? colors.textPrimary',
      '    : metric.startsWith("+")',
      '      ? colors.success',
      '      : colors.error;',
      '',
    ].join('\n'),
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain(`${SHEET}:5`);
  expect(output).toContain(`${SHEET}:6`);
});

it('leaves a fixed token alone', () => {
  const root = fixture({
    [SHEET]: 'const styles = { tint: { backgroundColor: colors.success } };\n',
  });

  expect(runGuard(root).status).toBe(0);
});

it('still fails a polarity read off the insight icon palette', () => {
  const root = fixture({ [SHEET]: 'const c = insightIcon.positive;\n' });

  expect(runGuard(root).status).toBe(1);
});

it('leaves a light or dark theme pick alone', () => {
  const root = fixture({
    [SHEET]: 'const danger = isDark ? darkColors.error : colors.error;\n',
  });

  expect(runGuard(root).status).toBe(0);
});

describe('outside the insight cards', () => {
  const BADGE = 'src/features/stats/components/Badge.tsx';

  it('fails a fill colour picked by a ternary on a good flag', () => {
    const root = fixture({
      [BADGE]: 'const fill = analysis.isGood ? colors.success : colors.warning;\n',
    });

    const { status, output } = runGuard(root);

    expect(status).toBe(1);
    expect(output).toContain(`${BADGE}:1`);
  });

  it('fails a ternary on a name the flag was bound to first', () => {
    const root = fixture({
      [BADGE]: [
        'const healthy = analysis.isGood;',
        'const fill = healthy ? colors.success : colors.warning;',
        '',
      ].join('\n'),
    });

    const { status, output } = runGuard(root);

    expect(status).toBe(1);
    expect(output).toContain(`${BADGE}:2`);
  });

  it('fails a ternary on a state that is not listed as one', () => {
    const root = fixture({
      [BADGE]: 'const fill = connected ? colors.success : colors.warning;\n',
    });

    const { status, output } = runGuard(root);

    expect(status).toBe(1);
    expect(output).toContain(`${BADGE}:1`);
  });

  it('leaves a listed state choice alone', () => {
    const root = fixture({
      'src/features/recording/components/TimerHeader.tsx':
        'const dot = status === "recording" ? colors.error : colors.warning;\n',
    });

    expect(runGuard(root).status).toBe(0);
  });
});
