/**
 * Scenario: the scale carries a weight of 500, which a static font file
 * resolves to 400 on one platform and 600 on the other, or it lacks a style
 * the style guide names, so a screen re-picks size and weight by hand.
 *
 * Expected behaviour: `typography` holds exactly the guide's 28 styles, each
 * with the guide's size, line height, weight and letter spacing, and every
 * weight is 400, 600 or 700.
 */

import { typography } from '@/theme/typography';

type Spec = [fontSize: number, lineHeight: number, fontWeight: string, letterSpacing?: number];

const GUIDE: Record<string, Spec> = {
  screenTitle: [28, 34, '700', -0.5],
  sectionTitle: [22, 28, '700', -0.3],
  cardTitle: [18, 24, '600', -0.2],
  body: [16, 22, '400'],
  bodyBold: [16, 22, '600'],
  bodyMedium: [15, 21, '400'],
  bodySmall: [14, 20, '400'],
  bodySmallBold: [14, 20, '600'],
  bodyCompact: [13, 18, '400'],
  bodyCompactBold: [13, 18, '600'],
  heroNumber: [48, 56, '700', -1],
  statsHero: [44, 50, '700', -0.5],
  largeNumber: [36, 42, '700', -0.8],
  headlineNumber: [32, 38, '700', -0.6],
  statsValueLarge: [24, 30, '700', -0.4],
  statsValue: [20, 26, '700', -0.3],
  metricValue: [18, 24, '600'],
  tableValue: [14, 20, '400'],
  pillValue: [14, 18, '700'],
  statsLabel: [12, 16, '400', 0.3],
  sectionHeader: [12, 16, '600', 0.3],
  caption: [12, 16, '400'],
  captionBold: [12, 16, '600'],
  label: [11, 14, '600', 0.4],
  badge: [11, 14, '600'],
  micro: [10, 12, '400', 0.2],
  pillLabel: [9, 11, '600', 0.3],
  code: [13, 20, '400'],
};

describe('the type scale', () => {
  it("holds exactly the guide's 28 styles", () => {
    expect(Object.keys(GUIDE)).toHaveLength(28);
    expect(Object.keys(typography).sort()).toEqual(Object.keys(GUIDE).sort());
  });

  it.each(Object.entries(GUIDE))('draws %s at the guide size and weight', (name, spec) => {
    const [fontSize, lineHeight, fontWeight, letterSpacing] = spec;
    const style = typography[name as keyof typeof typography] as Record<string, unknown>;

    expect(style).toMatchObject({ fontSize, lineHeight, fontWeight });
    expect(style.letterSpacing).toBe(letterSpacing);
  });

  it('carries no weight but 400, 600 and 700', () => {
    const weights = new Set(Object.values(typography).map((style) => style.fontWeight));

    expect([...weights].sort()).toEqual(['400', '600', '700']);
  });
});
