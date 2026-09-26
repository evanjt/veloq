/**
 * The week windows the fitness screens read over, as wall-clock stamps.
 *
 * `activity_metrics.date` is `start_date_local` stamped as UTC, a zoneless wall
 * clock rather than an instant. A bound built with `Date.getTime()` is a true
 * instant, so comparing the two slides the window by the device's UTC offset:
 * east of Greenwich a Monday 00:30 ride falls into the previous week, west of
 * it a Sunday evening ride falls into the next.
 *
 * Both bounds here go through `localWallClockToEpochSeconds`, which is what the
 * widget snapshot, the strength volume and the insights parameters already use.
 */

import { getMonday, getSunday } from '@/shared/format/format';
import { localWallClockToEpochSeconds } from '@/shared/time/startDate';

/**
 * The Monday anchors for a run of weeks back from `currentMonday`, oldest
 * first, as the stamps the engine compares against.
 */
export function mondayAnchors(currentMonday: Date, weeksBack: number): Date[] {
  const mondays: Date[] = [];
  for (let i = weeksBack; i >= 0; i--) {
    const monday = new Date(currentMonday);
    monday.setDate(monday.getDate() - i * 7);
    mondays.push(monday);
  }
  return mondays;
}

/** One Monday as the stamp the engine's week comparison is in. */
export function weekAnchorSeconds(monday: Date): number {
  return localWallClockToEpochSeconds(monday);
}

/** This calendar week and the one before it, as the four stamps the summary
 *  card bundle compares. Monday to Sunday, wall clock like every other bound
 *  here. */
export function currentAndPreviousWeek(now: Date): {
  weekStartTs: number;
  weekEndTs: number;
  prevStartTs: number;
  prevEndTs: number;
} {
  const monday = getMonday(now);
  const sunday = getSunday(now);
  sunday.setHours(23, 59, 59, 0);
  const prevMonday = new Date(monday);
  prevMonday.setDate(prevMonday.getDate() - 7);
  const prevSunday = new Date(monday);
  prevSunday.setDate(prevSunday.getDate() - 1);
  prevSunday.setHours(23, 59, 59, 0);
  return {
    weekStartTs: localWallClockToEpochSeconds(monday),
    weekEndTs: localWallClockToEpochSeconds(sunday),
    prevStartTs: localWallClockToEpochSeconds(prevMonday),
    prevEndTs: localWallClockToEpochSeconds(prevSunday),
  };
}
