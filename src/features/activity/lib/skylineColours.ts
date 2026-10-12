import { zoneColour } from '@/theme';
import type { SkylineData } from './skylineDecoder';

/**
 * One fill per skyline interval. Power and heart rate share the zone ladder,
 * so the basis does not change a step's colour.
 */
export function skylineColours(decoded: SkylineData, isDark: boolean): string[] {
  return decoded.intervals.map((interval) => zoneColour(interval.zone, isDark, 'fill'));
}
