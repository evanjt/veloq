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

import { localWallClockToEpochSeconds } from '@/shared/time/startDate';

export interface WeekWindow {
  weekStartTs: number;
  weekEndTs: number;
}

/**
 * The last seven days, local midnight to the last second of today.
 *
 * The end used to be the start of today, which left today's own rides out of
 * the shape they belong to: a ride finished this morning showed nothing until
 * tomorrow.
 */
export function lastSevenDaysWindow(now: Date): WeekWindow {
  const end = new Date(now);
  end.setHours(23, 59, 59, 0);
  const start = new Date(now);
  start.setDate(start.getDate() - 6);
  start.setHours(0, 0, 0, 0);
  return {
    weekStartTs: localWallClockToEpochSeconds(start),
    weekEndTs: localWallClockToEpochSeconds(end),
  };
}

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
