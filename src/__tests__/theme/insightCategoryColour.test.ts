/**
 * Scenario: an insight category is a topic, not a judgement, yet the strength
 * balance card was painted in the error red, so a balanced pair arrived in the
 * same hue the verdict ladder keeps for a decline.
 *
 * Expected behaviour: no category, in either theme, wears a polarity rung or
 * the error tone, and the card reads the category through the themed accessor
 * so the dark screen gets its own step.
 */

import { colors, darkColors, insightCategoryColor, insightCategoryColors, verdict } from '@/theme';

const CATEGORIES = Object.keys(insightCategoryColors);

const JUDGEMENT_TONES = new Set(
  [
    ...(['negative', 'caution', 'positive'] as const).flatMap((rung) => [
      verdict[rung].light,
      verdict[rung].dark,
    ]),
    colors.errorText,
    darkColors.errorText,
  ].map((hex) => hex.toUpperCase())
);

describe('insight category colours', () => {
  it.each(CATEGORIES)('%s wears no verdict polarity or error tone', (category) => {
    for (const isDark of [false, true]) {
      expect(JUDGEMENT_TONES.has(insightCategoryColor(category, isDark).toUpperCase())).toBe(false);
    }
  });

  it('gives the dark theme its own step for every category', () => {
    const shared = CATEGORIES.filter(
      (category) => insightCategoryColor(category, false) === insightCategoryColor(category, true)
    );

    expect(shared).toStrictEqual([]);
  });

  it("falls back to the theme's primary for a category it does not know", () => {
    expect(insightCategoryColor('unheard_of', false)).toBe(colors.actionPrimary);
    expect(insightCategoryColor('unheard_of', true)).toBe(darkColors.actionPrimary);
  });
});
