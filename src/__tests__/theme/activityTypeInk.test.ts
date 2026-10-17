/**
 * Scenario: an activity type's icon is drawn in its sport hue straight on a
 * sheet, card or screen surface: the type picker, the record screen's chips
 * and planned workouts, the recordings list, the recording header.
 *
 * Expected behaviour: every type's icon tone clears the 3:1 a mark owes on
 * every surface of the theme on screen, light and dark.
 */

import { getActivityInk } from '@/shared/activity/activityUtils';
import { activityTypeColors, colors, darkColors } from '@/theme/colors';
import type { ActivityType } from '@/types';

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

const LIGHT_SURFACES = [colors.surface, colors.surfacePage, colors.surfaceInput];
const DARK_SURFACES = [
  darkColors.surfacePage,
  darkColors.surfaceInput,
  darkColors.surface,
  darkColors.surfaceRaised,
  darkColors.surfaceRaised,
];
const TYPES = Object.keys(activityTypeColors) as ActivityType[];

describe('getActivityInk', () => {
  it.each(TYPES)('draws the %s icon at 3:1 or more on every light surface', (type) => {
    for (const ground of LIGHT_SURFACES) {
      expect(contrastRatio(getActivityInk(type, false), ground)).toBeGreaterThanOrEqual(3);
    }
  });

  it.each(TYPES)('draws the %s icon at 3:1 or more on every dark surface', (type) => {
    for (const ground of DARK_SURFACES) {
      expect(contrastRatio(getActivityInk(type, true), ground)).toBeGreaterThanOrEqual(3);
    }
  });

  it('draws a type with no entry in the Other tone of the theme', () => {
    const unknown = 'SomeUnknownActivity' as ActivityType;
    expect(getActivityInk(unknown, false)).toBe(getActivityInk('Other' as ActivityType, false));
    expect(getActivityInk(unknown, true)).toBe(getActivityInk('Other' as ActivityType, true));
  });
});
