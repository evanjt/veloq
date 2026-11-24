/**
 * Scenario: the engine stores `start_date_local` as a zoneless wall clock
 * stamped as UTC, and the screens built their week bounds from true instants.
 *
 * Expected behaviour: every bound is a wall-clock stamp, so the same local
 * Monday resolves to the same number in every timezone.
 */

import {
  getISOWeekNumber,
  mondayAnchors,
  trailingDaysWindow,
  weekAnchorSeconds,
} from '@/features/fitness/lib/weekWindow';
import { formatWeekRange, getMonday, getSunday } from '@/shared/format/format';
import { startDateLocalToEpochSeconds } from '@/shared/time/startDate';

/** A local `Date` for wall-clock fields, which is what the device clock gives. */
function local(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

describe('the week window', () => {
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

describe('the trailing days window', () => {
  it('runs from the start of the day `days` ago to the end of today, in wall clock', () => {
    const { startTs, endTs } = trailingDaysWindow(7, local(2026, 9, 21, 15, 40));

    expect(startTs).toBe(startDateLocalToEpochSeconds('2026-09-14T00:00:00'));
    expect(endTs).toBe(startDateLocalToEpochSeconds('2026-09-21T23:59:59'));
  });

  it('holds an activity from the first and from the last day, and drops the day before', () => {
    const { startTs, endTs } = trailingDaysWindow(7, local(2026, 9, 21, 15, 40));
    const stamp = (iso: string) => startDateLocalToEpochSeconds(iso);

    expect(stamp('2026-09-14T00:30:00')).toBeGreaterThanOrEqual(startTs);
    expect(stamp('2026-09-21T23:00:00')).toBeLessThanOrEqual(endTs);
    expect(stamp('2026-09-13T23:30:00')).toBeLessThan(startTs);
  });
});

// ---------------------------------------------------------------------------
// getISOWeekNumber
// ---------------------------------------------------------------------------

describe('getISOWeekNumber', () => {
  it('returns ISO week 1 for week-1 dates across year boundaries', () => {
    const cases: [Date, string][] = [
      [new Date(2024, 0, 1), 'Jan 1 2024 (Monday) is ISO week 1'],
      [new Date(2024, 11, 31), 'Dec 31 2024 (Tuesday) → ISO week 1 of 2025'],
      [new Date(2026, 0, 1), 'Jan 1 2026 (Thursday) → first-Thursday week is week 1'],
      [new Date(2025, 11, 29), 'Dec 29 2025 (Monday) → week 1 of 2026'],
    ];
    for (const [date, label] of cases) {
      expect({ label, week: getISOWeekNumber(date) }).toEqual({ label, week: 1 });
    }
  });

  it('returns the mid-year week number, and week 1 for Dec 31 2025', () => {
    expect(getISOWeekNumber(new Date(2026, 0, 27))).toBe(5);
    expect(getISOWeekNumber(new Date(2025, 11, 31))).toBe(1);
  });

  it('returns consistent results for all days in same week', () => {
    // Week of 2025-03-03 (Monday) to 2025-03-09 (Sunday)
    const weekNum = getISOWeekNumber(new Date(2025, 2, 3));
    for (let d = 3; d <= 9; d++) {
      expect(getISOWeekNumber(new Date(2025, 2, d))).toBe(weekNum);
    }
  });
});

describe('the calendar week around a date', () => {
  it('starts on the Monday and ends on the Sunday, for a Monday, a Saturday and a Sunday', () => {
    for (const day of [19, 24, 25]) {
      const date = new Date(2026, 0, day, 14, 0, 0);
      const monday = getMonday(date);
      const sunday = getSunday(date);
      expect([monday.getMonth(), monday.getDate(), monday.getHours()]).toEqual([0, 19, 0]);
      expect([sunday.getMonth(), sunday.getDate()]).toEqual([0, 25]);
      expect(formatWeekRange(monday, 'en-AU')).toBe('19–25 Jan');
      expect(getISOWeekNumber(date)).toBe(4);
    }
  });

  it('reaches back across a month boundary from a Sunday', () => {
    const monday = getMonday(new Date(2026, 1, 1));
    expect([monday.getMonth(), monday.getDate()]).toEqual([0, 26]);
  });

  it('keeps an activity inside the week that its Saturday falls in', () => {
    const saturday = new Date(2026, 0, 24, 23, 59, 0);
    const start = getMonday(saturday).getTime();
    const end = getSunday(saturday).getTime() + 24 * 60 * 60 * 1000 - 1;
    expect(saturday.getTime()).toBeGreaterThanOrEqual(start);
    expect(saturday.getTime()).toBeLessThanOrEqual(end);
  });
});
