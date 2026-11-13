/**
 * Scenario: the secondary button drew its edge at two hairlines in the divider
 * colour, a width no other control used and an edge that fell under 3:1, so
 * the control read as a faint box rather than something to press.
 *
 * Expected behaviour: the edge is the one-point control stroke in the control
 * edge colour, holding 3:1 against the button's own ground and every surface it
 * sits on, in both themes.
 */
import { paint } from '@/shared/ui/Button';
import { colors, darkColors, stroke } from '@/theme';

const MARK = 3;

function contrastRatio(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('the secondary button edge', () => {
  it.each([
    ['light', false, [colors.surface, colors.surfacePage, colors.surfaceInput]],
    [
      'dark',
      true,
      [
        darkColors.surface,
        darkColors.surfaceRaised,
        darkColors.surfacePage,
        darkColors.surfaceInput,
      ],
    ],
  ] as const)('is a one-point stroke holding 3:1 in the %s theme', (_, isDark, grounds) => {
    const skin = paint('secondary', isDark);

    expect(skin.borderWidth).toBe(stroke.one);
    for (const ground of grounds) {
      const ratio = contrastRatio(skin.borderColor, ground);
      expect(`${ground} ${ratio.toFixed(2)}`).toBe(`${ground} ${Math.max(ratio, MARK).toFixed(2)}`);
    }
  });
});
