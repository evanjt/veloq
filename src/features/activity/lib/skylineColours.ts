import { POWER_ZONE_COLORS, HR_ZONE_COLORS } from '@/shared/app/useSportSettings';
import { darkColors } from '@/theme';
import type { SkylineData } from './skylineDecoder';

/** One fill per skyline interval, from the palette of the zone basis. */
export function skylineColours(decoded: SkylineData, isDark: boolean): string[] {
  const palette = decoded.zoneBasis === 'hr' ? HR_ZONE_COLORS : POWER_ZONE_COLORS;
  return decoded.intervals.map((interval) => {
    const zoneIndex = Math.min(Math.max(interval.zone - 1, 0), palette.length - 1);
    // Z7 is near-black, so dark mode swaps it to light grey for visibility.
    if (isDark && interval.zone === 7 && decoded.zoneBasis === 'power') {
      return darkColors.zone7;
    }
    return palette[zoneIndex];
  });
}
