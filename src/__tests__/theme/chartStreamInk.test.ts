/**
 * Scenario: a selected chart chip fills with its stream hue and prints the icon,
 * label and value over it. White on the elevation green is 1.51:1.
 *
 * Expected behaviour: every stream hue has an ink in the table beside it, and
 * that ink clears 4.5:1 on the hue.
 */

import { chartStreamColors, chartStreamInk, chartInkColor } from '@/theme/colors';

const TEXT_BAR = 4.5;

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('selected chart chip ink', () => {
  it.each(Object.entries(chartStreamColors))('%s clears 4.5:1 on its hue', (stream, hue) => {
    const ink = chartInkColor(stream as keyof typeof chartStreamColors);
    expect(ink).toBeDefined();
    expect(contrastRatio(ink, hue)).toBeGreaterThanOrEqual(TEXT_BAR);
  });

  it('has no entry for a stream that does not exist', () => {
    expect(Object.keys(chartStreamInk).sort()).toEqual(Object.keys(chartStreamColors).sort());
  });
});
