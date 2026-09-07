/**
 * Scenario: the accessibility bar puts text at 4.5:1 against its background,
 * checked over the token file rather than over eighty-two screens. Colour has
 * been in one place since the token sweep, so this is one test rather than a
 * per-screen audit.
 *
 * Expected behaviour: the two text tokens the screens actually read for body
 * copy clear 4.5:1 on every surface they are drawn on, in both themes.
 * `textDisabled` is deliberately not held to it: WCAG 1.4.3 exempts text on an
 * inactive control, and an exemption written down is not the same as a gap
 * nobody noticed.
 */

import { colors, darkColors } from '@/theme';

/** WCAG 2.2 AA for body text. */
const AA_TEXT = 4.5;

function channels(hex: string): [number, number, number] {
  const srgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = srgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return [linear[0], linear[1], linear[2]];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const LIGHT_SURFACES = {
  surface: colors.surface,
  background: colors.background,
  backgroundAlt: colors.backgroundAlt,
};

const DARK_SURFACES = {
  surface: darkColors.surface,
  surfaceElevated: darkColors.surfaceElevated,
  surfaceCard: darkColors.surfaceCard,
};

describe('contrastRatio', () => {
  it('puts black on white at 21:1 and a colour against itself at 1:1', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
    expect(contrastRatio('#18181B', '#18181B')).toBeCloseTo(1, 5);
  });

  it('does not care which way round the pair is given', () => {
    expect(contrastRatio('#18181B', '#FFFFFF')).toBeCloseTo(contrastRatio('#FFFFFF', '#18181B'), 5);
  });
});

describe('body text clears AA on every surface it is drawn on', () => {
  it.each(Object.keys(LIGHT_SURFACES))('light textPrimary on %s', (surface) => {
    const ground = LIGHT_SURFACES[surface as keyof typeof LIGHT_SURFACES];
    expect(contrastRatio(colors.textPrimary, ground)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(Object.keys(LIGHT_SURFACES))('light textSecondary on %s', (surface) => {
    const ground = LIGHT_SURFACES[surface as keyof typeof LIGHT_SURFACES];
    expect(contrastRatio(colors.textSecondary, ground)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(Object.keys(DARK_SURFACES))('dark textPrimary on %s', (surface) => {
    const ground = DARK_SURFACES[surface as keyof typeof DARK_SURFACES];
    expect(contrastRatio(darkColors.textPrimary, ground)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(Object.keys(DARK_SURFACES))('dark textSecondary on %s', (surface) => {
    const ground = DARK_SURFACES[surface as keyof typeof DARK_SURFACES];
    expect(contrastRatio(darkColors.textSecondary, ground)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('holds the worst pair of the four with headroom, not on the line', () => {
    const worst = Math.min(
      ...Object.values(LIGHT_SURFACES).map((g) => contrastRatio(colors.textSecondary, g)),
      ...Object.values(DARK_SURFACES).map((g) => contrastRatio(darkColors.textSecondary, g))
    );

    expect(worst).toBeGreaterThan(AA_TEXT);
  });
});
