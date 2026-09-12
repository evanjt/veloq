/**
 * Scenario: the engine stores `start_date_local` as a zoneless wall clock
 * stamped as UTC, and the screens built their week bounds from true instants.
 *
 * Expected behaviour: both bounds are wall-clock stamps, so the same local
 * Monday resolves to the same number in every timezone, and today's own rides
 * are inside the week they belong to.
 */

import {
  lastSevenDaysWindow,
  mondayAnchors,
  weekAnchorSeconds,
} from '@/features/fitness/lib/weekWindow';
import { startDateLocalToEpochSeconds } from '@/shared/time/startDate';

/** A local `Date` for wall-clock fields, which is what the device clock gives. */
function local(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

describe('the week window', () => {
  it('starts at the local midnight six days back and ends with today', () => {
    const { weekStartTs, weekEndTs } = lastSevenDaysWindow(local(2026, 9, 12, 14, 30));

    expect(weekStartTs).toBe(Date.UTC(2026, 8, 6, 0, 0, 0) / 1000);
    expect(weekEndTs).toBe(Date.UTC(2026, 8, 12, 23, 59, 59) / 1000);
  });

  it('includes a ride finished this morning, which the start of today excluded', () => {
    const { weekStartTs, weekEndTs } = lastSevenDaysWindow(local(2026, 9, 12, 14, 30));
    const thisMorning = startDateLocalToEpochSeconds('2026-09-12T07:15:00');

    expect(thisMorning).toBeGreaterThanOrEqual(weekStartTs);
    expect(thisMorning).toBeLessThanOrEqual(weekEndTs);
  });

  it('keeps a Monday 00:30 ride inside the week that Monday starts', () => {
    const monday = local(2026, 9, 7);
    const anchor = weekAnchorSeconds(monday);
    const justAfterMidnight = startDateLocalToEpochSeconds('2026-09-07T00:30:00');

    expect(justAfterMidnight).toBeGreaterThanOrEqual(anchor);
    expect(justAfterMidnight).toBeLessThan(anchor + 7 * 24 * 60 * 60);
  });

  it('keeps a Sunday 22:00 ride out of the next week', () => {
    const nextMonday = weekAnchorSeconds(local(2026, 9, 14));
    const sundayNight = startDateLocalToEpochSeconds('2026-09-13T22:00:00');

    expect(sundayNight).toBeLessThan(nextMonday);
  });

  it('anchors every week oldest first, one Monday apart', () => {
    const anchors = mondayAnchors(local(2026, 9, 7), 2);

    expect(anchors.map((d) => d.getDate())).toEqual([24, 31, 7]);
    expect(weekAnchorSeconds(anchors[2]) - weekAnchorSeconds(anchors[1])).toBe(7 * 24 * 60 * 60);
  });

  it('reads the same number for the same wall clock whatever the offset', () => {
    // The bug this pins: `getTime()` is a true instant, so the same local
    // Monday produced a different number in every zone and the comparison
    // against a wall-clock stamp slid by the offset.
    const monday = local(2026, 9, 7);

    expect(weekAnchorSeconds(monday)).toBe(Date.UTC(2026, 8, 7, 0, 0, 0) / 1000);
  });
});
