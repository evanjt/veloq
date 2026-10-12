import { isPaceSport, isSwimmingActivity } from '@/shared/activity/activityUtils';
import { formatDuration, formatPace, formatSpeed, formatSwimPace } from '@/shared/format/format';
import type { ActivityType } from '@/types';

/**
 * What an attempt's figures read as. A timed chart plots moving time, so every
 * figure beside it is a time. Otherwise a pace sport reads pace, and a speed
 * sport plots speed with its bests and averages as times.
 */
export type AttemptBasis = 'time' | 'pace' | 'swimPace' | 'speed';

export function attemptBasis(sport: string | undefined, timed: boolean): AttemptBasis {
  if (timed) return 'time';
  const type = sport as ActivityType;
  if (isSwimmingActivity(type)) return 'swimPace';
  return isPaceSport(type) ? 'pace' : 'speed';
}

/** Whether the basis prints a pace rather than a time or a speed. */
export function readsPace(basis: AttemptBasis): boolean {
  return basis === 'pace' || basis === 'swimPace';
}

/** A best or an average in its basis: a pace from its speed, else its time. */
export function formatAttemptFigure(
  basis: AttemptBasis,
  time: number,
  speed: number | null | undefined,
  isMetric: boolean
): string {
  if (speed != null && speed > 0) {
    if (basis === 'pace') return formatPace(speed, isMetric);
    if (basis === 'swimPace') return formatSwimPace(speed, isMetric);
  }
  return formatDuration(time);
}

/** One attempt's headline in its basis: the time a timed chart plots, else its pace or speed. */
export function formatAttemptHeadline(
  basis: AttemptBasis,
  time: number | null | undefined,
  speed: number,
  isMetric: boolean
): string {
  if (basis === 'time' && time != null) return formatDuration(time);
  if (basis === 'swimPace') return formatSwimPace(speed, isMetric);
  return basis === 'pace' ? formatPace(speed, isMetric) : formatSpeed(speed, isMetric);
}
