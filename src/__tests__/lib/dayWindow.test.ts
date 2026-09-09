/**
 * Scenario: feed windows are epoch bounds compared against dates the engine
 * stamps as wall clock reinterpreted as UTC.
 * Expected behaviour: the bounds never move with the device timezone, so an
 * evening ride in UTC+10 stays on its own day and no day falls between pages.
 */
import {
  addDaysToDay,
  dayEndEpochSeconds,
  dayStartEpochSeconds,
  startDateLocalToEpochSeconds,
} from '@/shared/time/startDate';

const ZONES = ['UTC', 'Australia/Sydney', 'America/Los_Angeles'];

function inZone<T>(tz: string, fn: () => T): T {
  const original = process.env.TZ;
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    process.env.TZ = original;
  }
}

describe('calendar day windows', () => {
  it('bounds a day the same way in every timezone', () => {
    const starts = ZONES.map((tz) => inZone(tz, () => dayStartEpochSeconds('2026-08-22')));
    const ends = ZONES.map((tz) => inZone(tz, () => dayEndEpochSeconds('2026-08-22')));

    expect(new Set(starts).size).toBe(1);
    expect(new Set(ends).size).toBe(1);
    expect(ends[0] - starts[0]).toBe(86399);
  });

  it('includes an evening activity in its own day', () => {
    const stamp = startDateLocalToEpochSeconds('2026-08-22T18:30:00')!;

    for (const tz of ZONES) {
      const [start, end] = inZone(tz, () => [
        dayStartEpochSeconds('2026-08-22'),
        dayEndEpochSeconds('2026-08-22'),
      ]);
      expect(stamp).toBeGreaterThanOrEqual(start);
      expect(stamp).toBeLessThanOrEqual(end);
    }
  });

  it('steps pages without leaving a gap or an overlap', () => {
    for (const tz of ZONES) {
      inZone(tz, () => {
        const oldest = '2026-03-02';
        const nextEnd = addDaysToDay(oldest, -1);
        expect(nextEnd).toBe('2026-03-01');
        expect(dayEndEpochSeconds(nextEnd) + 1).toBe(dayStartEpochSeconds(oldest));
        expect(addDaysToDay(nextEnd, -30)).toBe('2026-01-30');
      });
    }
  });
});
