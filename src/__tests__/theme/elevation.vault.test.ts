/**
 * Scenario: a raised surface spreads a shadow preset in both themes, and on the
 * near-black dark ground the shadow does not read, so the surface sits flat.
 *
 * Expected behaviour: in dark a card swaps its shadow for a 1px card edge, and
 * anything that floats keeps its shadow and adds the same edge. Light is the
 * preset untouched. The lint refuses a preset spread outside the theme, so the
 * dark branch cannot be left out again.
 */

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { colors, darkColors } from '@/theme/colors';
import { raised, shadows } from '@/theme/shadows';
import { stroke } from '@/theme/stroke';

const SHADOW_KEYS = ['shadowColor', 'shadowOffset', 'shadowOpacity', 'shadowRadius', 'elevation'];
const FLOATING = ['elevated', 'modal', 'pill', 'mapOverlay', 'fab'] as const;

function drawsShadow(style: object): boolean {
  const s = style as Record<string, unknown>;
  return (
    (typeof s.shadowOpacity === 'number' && s.shadowOpacity > 0) ||
    (typeof s.elevation === 'number' && s.elevation > 0)
  );
}

describe('raised', () => {
  it('gives a light card the card preset and no edge', () => {
    const style = raised('card', false);
    expect(style).toEqual(shadows.card);
    expect(style).not.toHaveProperty('borderWidth');
  });

  it('gives a dark card no shadow and a 1px card edge', () => {
    const style = raised('card', true);
    expect(drawsShadow(style)).toBe(false);
    for (const key of SHADOW_KEYS) {
      const value = (style as Record<string, unknown>)[key];
      if (value !== undefined)
        expect([0, 'transparent']).toContain(typeof value === 'object' ? 0 : value);
    }
    expect(style).toMatchObject({ borderWidth: stroke.one, borderColor: darkColors.cardEdge });
  });

  it.each(FLOATING)('gives a light %s its preset and no edge', (level) => {
    const style = raised(level, false);
    expect(style).toEqual(shadows[level]);
    expect(style).not.toHaveProperty('borderWidth');
  });

  it.each(FLOATING)('gives a dark %s its shadow and the card edge', (level) => {
    const style = raised(level, true);
    expect(style).toMatchObject(shadows[level]);
    expect(drawsShadow(style)).toBe(true);
    expect(style).toMatchObject({ borderWidth: stroke.one, borderColor: darkColors.cardEdge });
  });

  it('keeps the iOS opacity boost on the presets it hands out', () => {
    // Elevation 2 at the default 1.5 boost: (0.03 + 2 * 0.02) * 1.5.
    expect(raised('card', false).shadowOpacity).toBeCloseTo(0.105);
    // Elevation 1 at its own 2x boost: (0.03 + 1 * 0.02) * 2.
    expect(raised('pill', true).shadowOpacity).toBeCloseTo(0.1);
  });

  it('reads the dark edge from the card-edge role, which holds 3:1, not the row divider', () => {
    expect(darkColors.cardEdge).toBeDefined();
    expect(darkColors.cardEdge).not.toBe(darkColors.border);
    expect(colors.cardEdge).toBe(colors.border);
  });

  it('hands out one object per level and theme, so a style array does not churn', () => {
    expect(raised('card', true)).toBe(raised('card', true));
    expect(raised('pill', true)).toBe(raised('pill', true));
  });
});

const ROOT = join(__dirname, '../../..');

function lint(source: string, filename = 'src/elevationLintFixture.ts'): string {
  try {
    execFileSync(
      'npx',
      ['eslint', '--stdin', '--stdin-filename', filename, '--no-warn-ignored', '--format', 'json'],
      { input: source, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], cwd: ROOT }
    );
    return '';
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    return `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
}

describe('the raised-surface lint', () => {
  it('refuses a shadow preset spread outside the theme', () => {
    const source =
      "import { shadows } from '@/theme';\nexport const s = { menu: { ...shadows.elevated } };\n";
    expect(lint(source)).toContain('Shadow preset');
  });

  it('refuses one placed in a style array', () => {
    const source = "import { shadows } from '@/theme';\nexport const s = [{}, shadows.card];\n";
    expect(lint(source)).toContain('Shadow preset');
  });

  it('accepts raised and the explicit none', () => {
    const source =
      "import { raised, shadows } from '@/theme';\nexport const s = [raised('card', true), shadows.none];\n";
    expect(lint(source)).not.toContain('Shadow preset');
  });
});
