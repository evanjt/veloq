/**
 * Resolves the colour tokens emitted by `combinedPlotData` into swatches.
 *
 * Kept apart from the prep layer so that layer stays free of theme imports
 * and can be tested without one.
 */

import { colourTokens, zoneColour } from '@/theme';
import type { BandColourToken } from './combinedPlotData';

/**
 * The colour an interval is drawn in, its band and the chip that keys it, or
 * null where it has no band. Intensity is always the zone ladder: a work
 * interval takes its zone, or the chart series colour where it carries none,
 * recovery takes zone 1, warm-up and cool-down take the muted chart colour,
 * and any other interval is drawn bare.
 */
export function resolveBandColour(token: BandColourToken, isDark: boolean): string | null {
  if (token.kind === 'zone') return zoneColour(token.zone, isDark);
  const tokens = colourTokens[isDark ? 'dark' : 'light'];
  switch (token.role) {
    case 'work':
      return tokens['chart-series'];
    case 'recovery':
      return zoneColour(1, isDark);
    case 'warmup':
    case 'cooldown':
      return tokens['chart-muted'];
    default:
      return null;
  }
}
