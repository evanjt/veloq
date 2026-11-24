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

import { TIME } from '@/shared/app/time';
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

/**
 * The `days` before today through the end of today, as wall-clock stamps: the
 * same calendar days a trailing range of that length is captioned with.
 */
export function trailingDaysWindow(days: number, now: Date): { startTs: number; endTs: number } {
  const end = new Date(now);
  end.setHours(23, 59, 59, 0);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - days);
  return {
    startTs: localWallClockToEpochSeconds(start),
    endTs: localWallClockToEpochSeconds(end),
  };
}

/**
 * The ISO week number of a date. Week 1 is the week holding the year's first
 * Thursday, so a week that starts in December can be week 1 of the next year.
 */
export function getISOWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / TIME.DAY + 1) / 7);
}
