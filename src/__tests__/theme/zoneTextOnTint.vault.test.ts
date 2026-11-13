/**
 * Scenario: the live heart rate number and its zone name are drawn over the
 * zone's tint.
 * Expected behaviour: primary text clears 4.5:1 on every zone tint over every
 * surface of its theme, so no zone needs its own text tone.
 */

import { colors, darkColors } from '@/theme/colors';
import { zoneTint } from '@/theme/zoneColour';

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

const ZONES = [1, 2, 3, 4, 5, 6, 7];

describe('primary text on a zone tint', () => {
  it.each([
    ['light', false, colors],
    ['dark', true, darkColors],
  ])('clears 4.5:1 on every zone tint in %s mode', (_name, isDark, palette) => {
    for (const ground of [palette.surfacePage, palette.surface, palette.surfaceRaised]) {
      for (const zone of ZONES) {
        const tint = over(zoneTint(zone, isDark as boolean), ground);
        expect(ratio(rgb(palette.textPrimary), tint)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
