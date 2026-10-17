import { colors, darkColors } from '@/theme';
import { ACTIVITY_CATEGORIES, isSportFamily } from '@/shared/activity/sportCategories';

/** A sport family's colour, the one its map filter chip carries. */
export function groupColor(group: string): string {
  return isSportFamily(group) ? ACTIVITY_CATEGORIES[group].color : colors.textSecondary;
}

/**
 * The days-trained pill: a tint and border of the day's first sport group, the
 * hue its map filter chip carries, with the label in the body ink. The group
 * hues are fills, and a label set in one on a tint of itself measured about
 * 2.4:1, so the hue stays on the pill and the word takes the ink.
 */
export function dayPillTone(
  group: string | undefined,
  isDark: boolean
): { fill: string; border: string; ink: string } {
  const hue = groupColor(group ?? '');
  return {
    fill: `${hue}${isDark ? '30' : '20'}`,
    border: `${hue}${isDark ? '50' : '40'}`,
    ink: isDark ? darkColors.textPrimary : colors.textPrimary,
  };
}
