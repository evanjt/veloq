/**
 * Scenario: a section is drawn in one of five hues on every map base, with a
 * number printed over the hue.
 *
 * Expected behaviour: each hue clears 3:1 against the edge drawn under it on
 * every base, and each hue's ink clears 4.5:1 on it in both themes.
 */

import { colourTokens, sectionPalette, sectionPaletteInk } from '@/theme';

const SLOTS = [1, 2, 3, 4, 5];

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

describe('the section palette', () => {
  const light = colourTokens.light as Record<string, string>;
  const dark = colourTokens.dark as Record<string, string>;

  it('is the five section tokens, in order', () => {
    expect(sectionPalette).toEqual(SLOTS.map((n) => light[`section-${n}`]));
    expect(SLOTS.map((n) => dark[`section-${n}`])).toEqual([...sectionPalette]);
  });

  it.each(SLOTS.flatMap((n) => ['light', 'dark', 'satellite'].map((base) => [n, base] as const)))(
    'section-%i clears 3:1 against the %s base edge',
    (n, base) => {
      expect(contrast(light[`section-${n}`]!, light[`map-${base}-edge`]!)).toBeGreaterThanOrEqual(
        3
      );
    }
  );

  it.each(
    SLOTS.flatMap(
      (n) =>
        [
          [n, 'light'],
          [n, 'dark'],
        ] as const
    )
  )('section-%i-ink clears 4.5:1 on its fill in the %s theme', (n, theme) => {
    const t = theme === 'light' ? light : dark;
    expect(contrast(t[`section-${n}-ink`]!, t[`section-${n}`]!)).toBeGreaterThanOrEqual(4.5);
  });

  it('prints dark ink on every slot', () => {
    expect(sectionPaletteInk).toEqual(SLOTS.map(() => 'dark'));
  });
});
