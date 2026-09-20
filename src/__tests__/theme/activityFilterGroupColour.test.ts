/**
 * Scenario: the map's activity-type filter paints each sport group in its own
 * hue. The racket group had no entry of its own and fell through to
 * `colors.success`, the semantic verdict green, so a change to the verdict would
 * have restyled a sport filter.
 *
 * Expected behaviour: no group resolves its colour from a verdict token, and the
 * racket hue does both jobs the chip asks of it. Unselected it is an icon on the
 * card, a mark at 3:1. Selected it is the fill under a white icon and label, so
 * the label owes 4.5:1.
 */

import { ACTIVITY_CATEGORIES } from '@/features/maps/components/ActivityTypeFilter';
import { colors } from '@/theme';

const BARS = { text: 4.5, mark: 3 } as const;

/** The verdict palette: what a sport group must never borrow. */
const VERDICT_TOKENS = ['success', 'warning', 'error', 'info'] as const;

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

describe('no sport group is painted from the verdict palette', () => {
  const verdicts = new Set(VERDICT_TOKENS.map((token) => colors[token].toUpperCase()));

  it.each(Object.entries(ACTIVITY_CATEGORIES))('%s', (_name, config) => {
    expect(verdicts.has(config.color.toUpperCase())).toBe(false);
  });
});

describe('the racket hue does both jobs the chip asks of it', () => {
  const racket = ACTIVITY_CATEGORIES.Racket.color;

  it('reads as an icon on the unselected chip', () => {
    expect(contrastRatio(racket, colors.surface)).toBeGreaterThanOrEqual(BARS.mark);
  });

  it('carries the selected chip label', () => {
    expect(contrastRatio(colors.textOnDark, racket)).toBeGreaterThanOrEqual(BARS.text);
  });

  it('is its own entry rather than a fallback', () => {
    expect(racket).not.toBe(colors.success);
  });
});
