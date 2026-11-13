/**
 * Scenario: the token file names every colour role the app draws in, and a
 * role edited there reaches every surface that reads it at once, so a value
 * under its bar is under it everywhere.
 *
 * Expected behaviour: every role is in a family, and each text and mark role
 * holds its WCAG bar on the guide's surfaces and the tints it is drawn on, or
 * an ink on the fills it names, in both themes.
 */

import { colourTokens } from '@/theme';
import {
  FAMILY_BARS,
  ROLE_EXEMPTIONS,
  ROLE_FAMILIES,
  ROLE_FILLS,
  ROLE_SURFACES,
  ROLE_TINTS,
} from '@/theme/tokenFamilies';

type Theme = keyof typeof colourTokens;
const THEMES: Theme[] = ['light', 'dark'];
const tokens = (theme: Theme): Record<string, string> => colourTokens[theme];

function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5]
    .map((at) => parseInt(hex.slice(at, at + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi = 0, lo = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const isRole = (name: string) =>
  !/^(neutral|blue|gold)-\d+$/.test(name) && !name.startsWith('map-');

describe('the colour roles', () => {
  it('puts every role of the token file in a family', () => {
    const roles = Object.keys(colourTokens.light).filter(isRole);
    expect(roles.filter((role) => !(role in ROLE_FAMILIES))).toStrictEqual([]);
    expect(Object.keys(ROLE_FAMILIES).filter((role) => !roles.includes(role))).toStrictEqual([]);
  });

  it('names only grounds the token file has', () => {
    const grounds = [
      ...ROLE_SURFACES,
      ...Object.values(ROLE_FILLS).flat(),
      ...Object.values(ROLE_TINTS).flat(),
    ];
    expect(grounds.filter((g) => !(g in colourTokens.light))).toStrictEqual([]);
  });

  const measured = THEMES.flatMap((theme) =>
    Object.entries(ROLE_FAMILIES)
      .filter(([role, family]) => family !== 'ground' && !(role in ROLE_EXEMPTIONS))
      .flatMap(([role, family]) =>
        (ROLE_FILLS[role] ?? [...ROLE_SURFACES, ...(ROLE_TINTS[role] ?? [])]).map(
          (ground) => [theme, role, ground, FAMILY_BARS[family]] as const
        )
      )
  );

  it.each(measured)('%s %s holds its bar on %s', (theme, role, ground, bar) => {
    const ratio = contrast(tokens(theme)[role] ?? '', tokens(theme)[ground] ?? '');
    expect(ratio).toBeGreaterThanOrEqual(bar);
  });
});
