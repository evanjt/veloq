import { directionPair } from '@/theme';
import type { ChartDirection } from '@/features/routes/lib/scatterData';

/**
 * The colour a route or section page draws a direction in, on every chart and
 * cue of the page. The pair is fixed rather than the sport's colour, so it
 * reads the same whatever the sport, and every reader pairs it with the
 * direction's word or arrow.
 */
export function directionColour(direction: ChartDirection, isDark: boolean): string {
  return directionPair[isDark ? 'dark' : 'light'][direction];
}
