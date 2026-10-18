/**
 * Scenario: an insight category has no colour of its own. The card names the
 * category with a neutral icon, and its graphic takes the colour of what the
 * insight measures, so two categories that measure the same kind of thing draw
 * the same hue and none of them wears a judgement.
 *
 * Expected behaviour: every category resolves to an icon and to one of the
 * four measure colours, in each theme from that theme's own tokens, and no
 * category's graphic is a polarity rung or the error tone.
 */

import { colourTokens, colors, darkColors, verdict } from '@/theme';
import {
  insightCategories,
  insightCategoryIcon,
  insightGraphicColour,
} from '@/features/insights/lib/insightCategory';
import type { InsightCategory } from '@/features/insights/types';

const MEASURES: Record<InsightCategory, string> = {
  section_pr: 'achievement',
  stale_pr: 'achievement',
  fitness_milestone: 'fitness-ctl',
  period_comparison: 'chart-series',
  hrv_trend: 'chart-series',
  section_trend: 'chart-series',
  route: 'chart-series',
  efficiency_trend: 'chart-series',
  section_changed: 'chart-series',
  strength_progression: 'sport-strength',
  strength_balance: 'sport-strength',
};

const CATEGORIES = Object.keys(MEASURES) as InsightCategory[];

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

describe('insight category table', () => {
  it('holds every category and nothing else', () => {
    expect(Object.keys(insightCategories).sort()).toEqual([...CATEGORIES].sort());
  });

  it.each(CATEGORIES)('draws the %s graphic in the colour of what it measures', (category) => {
    const token = MEASURES[category] as keyof typeof colourTokens.light;
    expect(insightGraphicColour(category, false)).toBe(colourTokens.light[token]);
    expect(insightGraphicColour(category, true)).toBe(colourTokens.dark[token]);
  });

  it.each(CATEGORIES)('gives %s a graphic that wears no judgement', (category) => {
    for (const isDark of [false, true]) {
      expect(JUDGEMENT_TONES.has(insightGraphicColour(category, isDark).toUpperCase())).toBe(false);
    }
  });

  it('gives each category an icon of its own', () => {
    const icons = CATEGORIES.map(insightCategoryIcon);
    expect(new Set(icons).size).toBe(CATEGORIES.length);
  });
});
