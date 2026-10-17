/**
 * Scenario: a control's on state, its edge and its focus outline were drawn in
 * the action fill, so the dark fill step moving decided whether a switch track,
 * a selected chip or a field edge could still be seen.
 *
 * Expected behaviour: each control role is its own token in both palettes and
 * holds 3:1 as a mark on every surface of its theme, and white on the on state
 * holds 4.5:1, so a label or a thumb drawn on it reads.
 */

import { colors, darkColors } from '@/theme';

function channels(hex: string): [number, number, number] {
  const srgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = srgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return [linear[0], linear[1], linear[2]];
}

function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, b] = channels(hex);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const THEMES = {
  light: {
    palette: colors as Record<string, string>,
    surfaces: ['surface', 'background', 'backgroundAlt'],
  },
  dark: {
    palette: darkColors as Record<string, string>,
    surfaces: ['background', 'backgroundAlt', 'surface', 'surfaceElevated', 'surfaceCard'],
  },
} as const;

const MARK_ROLES = ['controlOn', 'focusRing', 'controlBoundary'] as const;

describe('control roles', () => {
  for (const [theme, { palette, surfaces }] of Object.entries(THEMES)) {
    for (const role of MARK_ROLES) {
      it.each(surfaces)(`${theme} ${role} holds 3:1 on %s`, (surface) => {
        expect(palette[role]).toMatch(/^#[0-9A-Fa-f]{6}$/);
        expect(contrastRatio(palette[role], palette[surface])).toBeGreaterThanOrEqual(3);
      });
    }

    it(`${theme} white on controlOn holds 4.5:1`, () => {
      expect(contrastRatio(colors.textOnPrimary, palette.controlOn)).toBeGreaterThanOrEqual(4.5);
    });

    it.each(surfaces)(`${theme} textTertiary holds 4.5:1 on %s`, (surface) => {
      expect(contrastRatio(palette.textTertiary, palette[surface])).toBeGreaterThanOrEqual(4.5);
    });
  }
});
