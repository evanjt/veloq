import { colors, darkColors, sportFamilyColours } from '@/theme';
import { isSportFamily } from '@/shared/activity/sportCategories';

/** A sport family's colour in the scheme on screen, its family token's first step. */
export function groupColor(group: string, isDark: boolean): string {
  const neutral = isDark ? darkColors.textSecondary : colors.textSecondary;
  if (!isSportFamily(group)) return neutral;
  return sportFamilyColours[isDark ? 'dark' : 'light'][group][0] ?? neutral;
}

/**
 * The days-trained pill: a tint and border of the day's first sport family, the
 * hue its strip mark carries, with the label in the body ink. The group
 * hues are fills, and a label set in one on a tint of itself measured about
 * 2.4:1, so the hue stays on the pill and the word takes the ink.
 */
export function dayPillTone(
  group: string | undefined,
  isDark: boolean
): { fill: string; border: string; ink: string } {
  const hue = groupColor(group ?? '', isDark);
  return {
    fill: `${hue}${isDark ? '30' : '20'}`,
    border: `${hue}${isDark ? '50' : '40'}`,
    ink: isDark ? darkColors.textPrimary : colors.textPrimary,
  };
}
