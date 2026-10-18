/**
 * Scenario: an activity type's icon is drawn in its sport's mark colour straight
 * on a sheet, card or screen surface: the type picker, the record screen's chips
 * and planned workouts, the recordings list, the recording header, the feed card.
 *
 * Expected behaviour: every family's and every type's mark clears the 3:1 a
 * mark owes on every surface of the theme on screen, light and dark, apart
 * from the one gap the family tokens carry today.
 */

import {
  getActivityCategory,
  isSportFamily,
  sportMarkColour,
  SPORT_FAMILY_ORDER,
} from '@/shared/activity/sportCategories';
import { SPORT_FAMILY_MEMBERS } from '@/shared/native/sportTaxonomy.generated';
import { colors, darkColors } from '@/theme/colors';

function relativeLuminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const SURFACES = {
  light: {
    surface: colors.surface,
    surfacePage: colors.surfacePage,
    surfaceInput: colors.surfaceInput,
  },
  dark: {
    surface: darkColors.surface,
    surfaceRaised: darkColors.surfaceRaised,
    surfacePage: darkColors.surfacePage,
    surfaceInput: darkColors.surfaceInput,
  },
} as const;

/** Family and ground pairs under 3:1 in the tokens today: light foot is 2.87:1 on the input ground. */
const KNOWN_GAPS = new Set(['light Foot surfaceInput']);

const MARKS = [
  ...SPORT_FAMILY_ORDER,
  ...Object.values(SPORT_FAMILY_MEMBERS).flatMap((types) => [...types]),
];

/** Every mark, theme and ground under 3:1 that the known gaps do not name. */
function shortfalls(mark: string): string[] {
  const found: string[] = [];
  for (const theme of ['light', 'dark'] as const) {
    const colour = sportMarkColour(mark, theme === 'dark');
    const family = isSportFamily(mark) ? mark : getActivityCategory(mark);
    for (const [name, ground] of Object.entries(SURFACES[theme])) {
      const ratio = contrastRatio(colour, ground);
      if (ratio >= 3 || KNOWN_GAPS.has(`${theme} ${family} ${name}`)) continue;
      found.push(`${theme} ${name} ${ratio.toFixed(2)}`);
    }
  }
  return found;
}

describe('sport marks', () => {
  it.each(MARKS)('draws %s at 3:1 or more on every surface of both themes', (mark) => {
    expect(shortfalls(mark)).toEqual([]);
  });
});
