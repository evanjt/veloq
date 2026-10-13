import { colors, darkColors } from '@/theme';

/**
 * The colour a route or section page draws Forward in, on every view of the
 * page. It is the brand primary rather than the sport's colour, because Reverse
 * is a fixed pink and the pair has to read the same whatever the sport.
 */
export function forwardDirectionColour(isDark: boolean): string {
  return isDark ? darkColors.primary : colors.primary;
}
