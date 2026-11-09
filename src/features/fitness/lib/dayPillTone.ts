import { colors, darkColors, sportFamilyColours } from '@/theme';
import { isSportFamily } from '@/shared/activity/sportCategories';

/** A sport family's colour in the scheme on screen, its family token's first step. */
export function groupColor(group: string, isDark: boolean): string {
  const neutral = isDark ? darkColors.textSecondary : colors.textSecondary;
  if (!isSportFamily(group)) return neutral;
  return sportFamilyColours[isDark ? 'dark' : 'light'][group][0] ?? neutral;
}
