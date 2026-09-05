/**
 * How a week's load was spread, in words.
 *
 * The engine returns mean daily load over its standard deviation. That number
 * means nothing to an athlete and never reaches the screen: what a surface
 * shows is which of three readings it falls in. The word for this is not
 * "monotony", and none of these are jargon.
 *
 * The bands come from 190 loaded weeks measured on a real library: weeks
 * carrying 200 to 400
 * points ran from 0.45 to 1.92, so the range the reading has to separate is
 * roughly a half to two, and the thirds below split it where the weeks
 * actually fall rather than at round numbers.
 */
export type WeekShapeReading = 'lopsided' | 'mixed' | 'even';

/** Below this the load sat in a few days. */
const LOPSIDED_BELOW = 0.8;
/** At or above this it was spread across the week. */
const EVEN_FROM = 1.4;

export function describeWeekShape(evenness: number): WeekShapeReading {
  if (evenness < LOPSIDED_BELOW) return 'lopsided';
  if (evenness >= EVEN_FROM) return 'even';
  return 'mixed';
}
