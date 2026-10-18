/**
 * The delta chart's colour for time won or lost against its reference, on the
 * style guide's diverging ramp: cool for ahead, warm for behind, grey for
 * level. The banding is a pure function of the seconds and the plot's extent,
 * so every mark that colours a delta bands it the same way.
 */

import { colourTokens, divergingRamp } from '@/theme';

/** One side's three steps and the midpoint make seven bands. */
const BANDS = 7;
const STEPS = 3;

/**
 * Which of seven equal bands across `[-extentSecs, extentSecs]` holds `secs`:
 * -3 to -1 ahead (negative seconds), 0 level, 1 to 3 behind. A value past the
 * extent holds the outer band. Null for a value the curve does not have.
 */
export function deltaBand(secs: number, extentSecs: number): number | null {
  if (!Number.isFinite(secs)) return null;
  if (!(extentSecs > 0)) return 0;
  const step = Math.min(STEPS, Math.floor(((Math.abs(secs) / extentSecs) * BANDS + 1) / 2));
  return secs < 0 && step > 0 ? -step : step;
}

/** The ramp's colour for `secs` on a plot of `extentSecs` either side of the reference. */
export function deltaColour(secs: number, extentSecs: number, isDark: boolean): string {
  const band = deltaBand(secs, extentSecs);
  const theme = isDark ? 'dark' : 'light';
  if (band === null) return colourTokens[theme]['chart-muted'];
  const ramp = divergingRamp[theme];
  if (band === 0) return ramp.mid;
  const arm = band < 0 ? ramp.cool : ramp.warm;
  return arm[Math.abs(band) - 1] ?? ramp.mid;
}
