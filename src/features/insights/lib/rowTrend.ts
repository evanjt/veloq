/**
 * The trend a section or route row draws. The engine hands a row its trend
 * already judged as a sign: above zero is faster, below is slower, zero or
 * missing is no move worth naming. A faster time is the improvement, so the
 * sign maps straight onto a verdict and the glyph and rung come from the same
 * ladder every other trend surface reads.
 */

import { verdictColor } from '@/theme';
import { spokenVerdict } from '@/shared/format/spoken';
import {
  verdictIcon,
  verdictRung,
  type TrendDirection,
  type TrendIcon,
  type TrendVerdict,
} from '@/shared/format/trend';

function rowTrend(trend: number | null | undefined): {
  verdict: TrendVerdict;
  direction: TrendDirection;
} {
  if (trend != null && trend > 0) return { verdict: 'improved', direction: 'up' };
  if (trend != null && trend < 0) return { verdict: 'declined', direction: 'down' };
  return { verdict: 'flat', direction: 'flat' };
}

/** The icon for a row's trend: up for faster, down for slower, a dash for none. */
export function rowTrendIcon(trend: number | null | undefined): TrendIcon {
  const { verdict, direction } = rowTrend(trend);
  return verdictIcon(verdict, direction);
}

/** The ladder colour for a row's trend: positive for faster, negative for slower. */
export function rowTrendColor(trend: number | null | undefined, isDark: boolean): string {
  return verdictColor(verdictRung(rowTrend(trend).verdict), isDark);
}

/**
 * The word a screen reader speaks for a row's trend, from the same verdict the
 * glyph draws. None when the engine sent no trend, so a row without one is not
 * read as holding steady.
 */
export function rowTrendWord(trend: number | null | undefined): string | null {
  if (trend == null) return null;
  const { verdict, direction } = rowTrend(trend);
  return spokenVerdict(verdict, direction);
}
