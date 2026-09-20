/**
 * Scenario: the selection outline on the muscle diagram is painted along the
 * polygon boundaries, which are the page showing through, not the muscle fill.
 *
 * Expected behaviour: each theme has its own stroke, and each reads against
 * the ground it is actually drawn on.
 */

import { bodyDiagram, colors, darkColors } from '@/theme';

/** WCAG relative luminance of a `#rrggbb` tone. */
function luminance(hex: string): number {
  const channel = (pair: string) => {
    const value = parseInt(pair, 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const r = channel(hex.slice(1, 3));
  const g = channel(hex.slice(3, 5));
  const b = channel(hex.slice(5, 7));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

it('gives the dark theme its own stroke rather than the light one', () => {
  expect(bodyDiagram.selectedStrokeDark).toMatch(/^#[0-9a-fA-F]{6}$/);
  expect(bodyDiagram.selectedStrokeDark).not.toBe(bodyDiagram.selectedStroke);
});

it('reads against the surface each theme draws it on', () => {
  for (const surface of [colors.surface, colors.background, colors.backgroundAlt]) {
    expect(contrastRatio(bodyDiagram.selectedStroke, surface)).toBeGreaterThanOrEqual(3);
  }
  for (const surface of [darkColors.surface, darkColors.surfaceElevated, darkColors.surfaceCard]) {
    expect(contrastRatio(bodyDiagram.selectedStrokeDark, surface)).toBeGreaterThanOrEqual(3);
  }
});
