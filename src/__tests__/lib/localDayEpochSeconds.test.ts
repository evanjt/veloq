/**
 * Scenario: a local calendar date becomes the window bounds the engine reads,
 * in the same wall-clock-as-UTC space as its stored dates, and an engine date
 * is read back as the local date its wall clock names.
 * Expected behaviour: 5 Nov 00:00 and 23:59:59 map to `Date.UTC(2026, 10, 5)`
 * seconds at any device offset, east or west of Greenwich, and a stamp reads
 * back as the wall-clock day it was written with.
 */
import {
  localDayEndEpochSeconds,
  localDayStartEpochSeconds,
  wallClockSecondsToLocalDate,
} from '@/shared/time/startDate';
import { atUtcOffset } from '../__shared__/fixedOffsetDate';

const DAY_START = Date.UTC(2026, 10, 5) / 1000;

describe.each([
  ['Sydney', 11],
  ['Los Angeles', -8],
  ['UTC', 0],
])('local day bounds at the %s offset', (_zone, offset) => {
  it('starts the day at its wall-clock midnight', () => {
    const start = atUtcOffset(offset, () =>
      localDayStartEpochSeconds(new Date(2026, 10, 5, 15, 30))
    );
    expect(start).toBe(DAY_START);
  });

  it('ends the day at 23:59:59', () => {
    const end = atUtcOffset(offset, () => localDayEndEpochSeconds(new Date(2026, 10, 5, 0, 0)));
    expect(end).toBe(DAY_START + 86_399);
  });
});

describe.each([
  // Early morning west of Greenwich: read as UTC-local, the stamp lands on the day before.
  {
    zone: 'Los Angeles',
    offset: -8,
    stamp: Date.UTC(2026, 10, 5, 0, 30),
    day: 5,
    hour: 0,
    minute: 30,
  },
  // Late evening east of Greenwich: read as UTC-local, the stamp lands on the day after.
  {
    zone: 'Sydney',
    offset: 11,
    stamp: Date.UTC(2026, 10, 5, 23, 30),
    day: 5,
    hour: 23,
    minute: 30,
  },
])('an engine stamp read back at the $zone offset', ({ offset, stamp, day, hour, minute }) => {
  it('is the local date and time its wall clock names', () => {
    const read = atUtcOffset(offset, () => {
      const local = wallClockSecondsToLocalDate(stamp / 1000);
      return {
        year: local.getFullYear(),
        month: local.getMonth(),
        day: local.getDate(),
        hour: local.getHours(),
        minute: local.getMinutes(),
      };
    });
    expect(read).toEqual({ year: 2026, month: 10, day, hour, minute });
  });
});
