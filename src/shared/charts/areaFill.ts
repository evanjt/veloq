import { opacity } from '@/theme';

import type { Domain } from './cartesian';

/**
 * Whether an area may be shaded under a line on this y domain. A fill reads as
 * a quantity measured from its floor, so it is drawn only when that floor is
 * zero: an ascending, finite domain whose lower bound is 0. A raised axis, an
 * inverted one, or one whose floor sits below zero draws a bare line.
 */
export function areaFillsFromZero(yDomain: Domain): boolean {
  const [min, max] = yDomain;
  return min === 0 && Number.isFinite(max) && max > min;
}

/** The tint step a flat area wash takes: the first in light, the second in dark. */
export function areaWashOpacity(isDark: boolean): number {
  return isDark ? opacity.tint2 : opacity.tint1;
}
