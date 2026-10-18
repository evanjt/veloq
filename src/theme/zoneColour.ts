import { colorWithOpacity, opacity, zoneColorsLight, zoneColorsDark } from './colors';

const LADDERS: Record<'light' | 'dark', readonly string[]> = {
  light: Object.values(zoneColorsLight),
  dark: Object.values(zoneColorsDark),
};

/**
 * The fill of training zone `zone` in the scheme on screen: a bar, a dot, a
 * band or a step. Power and heart rate share the one seven-step ladder, so the
 * basis does not pick it. A fill holds 3:1 on every surface of its theme and is
 * never set as text: a zone's name and value are primary text beside a zone
 * dot or on a zone tint. A zone outside 1 to 7 takes the nearer end.
 */
export function zoneColour(zone: number, isDark: boolean): string {
  const ladder = LADDERS[isDark ? 'dark' : 'light'];
  const index = Math.min(Math.max(Math.round(zone), 1), ladder.length) - 1;
  return ladder[index] ?? '';
}

/**
 * Zone `zone` washed over a ground, behind a value set in primary text: the
 * faint tint in light, one step stronger in dark, where the same alpha reads
 * fainter.
 */
export function zoneTint(zone: number, isDark: boolean): string {
  return colorWithOpacity(zoneColour(zone, isDark), isDark ? opacity.tint3 : opacity.tint2);
}
