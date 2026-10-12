import { zoneColors, zoneColorsDark, zoneTextColors, zoneTextColorsDark } from './colors';

/** A zone drawn as a mark (a bar, a dot, a band) or as words beside it. */
export type ZoneColourRole = 'fill' | 'text';

const LADDERS: Record<ZoneColourRole, Record<'light' | 'dark', readonly string[]>> = {
  fill: { light: Object.values(zoneColors), dark: Object.values(zoneColorsDark) },
  text: { light: Object.values(zoneTextColors), dark: Object.values(zoneTextColorsDark) },
};

/**
 * The colour of training zone `zone` in the scheme on screen. Power and heart
 * rate share the one seven-step ladder, so the basis does not pick it. A fill
 * holds 3:1 on the dark surfaces and is never set as text; the text tone holds
 * 4.5:1 on every surface of its theme. A zone outside 1 to 7 takes the nearer
 * end.
 */
export function zoneColour(zone: number, isDark: boolean, role: ZoneColourRole): string {
  const ladder = LADDERS[role][isDark ? 'dark' : 'light'];
  const index = Math.min(Math.max(Math.round(zone), 1), ladder.length) - 1;
  return ladder[index] ?? '';
}
