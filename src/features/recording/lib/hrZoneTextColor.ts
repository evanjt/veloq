import { zoneTextColors, zoneTextColorsDark } from '@/theme/colors';

const LIGHT: readonly string[] = Object.values(zoneTextColors);
const DARK: readonly string[] = Object.values(zoneTextColorsDark);

/**
 * The colour for the heart rate number drawn on a zone's tinted tile. The zone
 * fill is for the tint; as text it falls to 1.3:1 to 3.5:1 on its own tint in
 * light mode, so the number takes a tone held to 4.5:1 in the scheme on screen.
 */
export function hrZoneTextColor(zone: number, isDark: boolean): string {
  const tones = isDark ? DARK : LIGHT;
  return tones.at(Math.min(Math.max(Math.round(zone), 1), tones.length) - 1) ?? '';
}
