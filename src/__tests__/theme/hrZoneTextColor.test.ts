/**
 * Scenario: the live heart rate number is drawn over its zone's tint.
 * Expected behaviour: every zone's text tone clears 4.5:1 on that tint in both
 * themes, which the zone fill itself does not.
 */

import { colors, darkColors, zoneColors, colorWithOpacity } from '@/theme/colors';
import { hrZoneTextColor } from '@/features/recording/lib/hrZoneTextColor';

function rgb(value: string): [number, number, number] {
  const rgba = value.match(/^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/);
  if (rgba) return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])];
  return [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16)) as [number, number, number];
}

function over(tint: string, ground: string): [number, number, number] {
  const a = Number(tint.match(/, ([\d.]+)\)$/)?.[1]);
  const f = rgb(tint);
  const g = rgb(ground);
  return [0, 1, 2].map((i) => f[i] * a + g[i] * (1 - a)) as [number, number, number];
}

function luminance([r, g, b]: [number, number, number]): number {
  const [lr, lg, lb] = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

function ratio(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const FILLS = Object.values(zoneColors);

describe('hrZoneTextColor', () => {
  it.each([
    ['light', false, colors.background, 0.18],
    ['dark', true, darkColors.background, 0.28],
  ])('clears 4.5:1 on every zone tint in %s mode', (_name, isDark, ground, alpha) => {
    FILLS.forEach((fill, i) => {
      const tint = over(colorWithOpacity(fill, alpha as number), ground as string);
      const tone = rgb(hrZoneTextColor(i + 1, isDark as boolean));
      expect(ratio(tone, tint)).toBeGreaterThanOrEqual(4.5);
    });
  });

  it('clamps a zone outside the ramp to its ends', () => {
    expect(hrZoneTextColor(0, false)).toBe(hrZoneTextColor(1, false));
    expect(hrZoneTextColor(9, true)).toBe(hrZoneTextColor(7, true));
  });
});
