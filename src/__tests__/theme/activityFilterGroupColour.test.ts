/**
 * Scenario: the map's activity-type filter paints each sport family in its own
 * hue. A family with no entry of its own fell through to `colors.success`, the
 * semantic verdict green, so a change to the verdict would have restyled a
 * sport filter.
 *
 * Expected behaviour: no family resolves its colour from a verdict token, and the
 * Other hue, which takes every sport no family lists, reads as a mark at 3:1 on
 * the card.
 */

import { ACTIVITY_CATEGORIES, FILTER_CHIP } from '@/features/maps/lib/activityCategories';
import { colors } from '@/theme';

const BARS = { text: 4.5, mark: 3 } as const;

/** The verdict palette: what a sport family must never borrow. */
const VERDICT_TOKENS = [
  'successText',
  'successFill',
  'warningText',
  'warningFill',
  'errorText',
  'dangerFill',
  'actionLink',
] as const;

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

describe('no sport family is painted from the verdict palette', () => {
  const verdicts = new Set(VERDICT_TOKENS.map((token) => colors[token].toUpperCase()));

  it.each(Object.entries(ACTIVITY_CATEGORIES))('%s', (_name, config) => {
    expect(verdicts.has(config.color.toUpperCase())).toBe(false);
  });
});

describe('the Other hue stands as its own mark', () => {
  const other = ACTIVITY_CATEGORIES.Other.color;

  it('reads as a mark on the card', () => {
    expect(contrastRatio(other, colors.surface)).toBeGreaterThanOrEqual(BARS.mark);
  });

  it('is its own entry rather than a fallback', () => {
    expect(other).not.toBe(colors.successText);
  });
});

describe('the map tab period and distance chips pick a readable fill and ink', () => {
  it('the selected period and distance chip clears 4.5:1', () => {
    expect(contrastRatio(FILTER_CHIP.ink, FILTER_CHIP.fill)).toBeGreaterThanOrEqual(BARS.text);
  });
});
