import { isPaceSport, isSwimmingActivity } from '@/shared/activity/activityUtils';
import {
  formatDuration,
  formatSpeed,
  paceUnitLabel,
  swimPaceUnitLabel,
} from '@/shared/format/format';
import { toActivityType } from '@/types';
import type { FfiPaceText } from 'veloqrs';

const ABSENT_PACE = '--:--';

/**
 * What an attempt's figures read as. A timed chart plots moving time, so every
 * figure beside it is a time. Otherwise a pace sport reads pace, and a speed
 * sport plots speed with its bests and averages as times.
 */
export type AttemptBasis = 'time' | 'pace' | 'swimPace' | 'speed';

export function attemptBasis(sport: string | undefined, timed: boolean): AttemptBasis {
  if (timed) return 'time';
  const type = toActivityType(sport);
  if (isSwimmingActivity(type)) return 'swimPace';
  return isPaceSport(type) ? 'pace' : 'speed';
}

/** Whether the basis prints a pace rather than a time or a speed. */
export function readsPace(basis: AttemptBasis): boolean {
  return basis === 'pace' || basis === 'swimPace';
}

/** A pace the engine wrote, with the unit of the sport and the system shown. */
function paceFigure(basis: 'pace' | 'swimPace', isMetric: boolean, text: FfiPaceText): string {
  const label = basis === 'swimPace' ? swimPaceUnitLabel(isMetric) : paceUnitLabel(isMetric);
  return `${isMetric ? text.metricText : text.imperialText} ${label}`;
}

/**
 * A best or an average in its basis: the engine's pace text for a pace sport,
 * else its time. A pace the engine did not write is not worked out here, so a
 * figure with none reads as its time.
 */
export function formatAttemptFigure(
  basis: AttemptBasis,
  time: number,
  paceText: FfiPaceText | null | undefined,
  isMetric: boolean
): string {
  if (paceText != null && (basis === 'pace' || basis === 'swimPace')) {
    return paceFigure(basis, isMetric, paceText);
  }
  return formatDuration(time);
}

/**
 * One attempt's headline in its basis: the time a timed chart plots, else the
 * engine's pace text for a pace sport, or the speed for a speed sport.
 */
export function formatAttemptHeadline(
  basis: AttemptBasis,
  time: number | null | undefined,
  speed: number,
  isMetric: boolean,
  paceText: FfiPaceText | null | undefined
): string {
  if (basis === 'time' && time != null) return formatDuration(time);
  if (basis === 'pace' || basis === 'swimPace') {
    return paceText == null ? ABSENT_PACE : paceFigure(basis, isMetric, paceText);
  }
  return formatSpeed(speed, isMetric);
}
