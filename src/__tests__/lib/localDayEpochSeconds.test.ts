/**
 * Scenario: a local calendar date becomes the window bounds the engine reads,
 * in the same wall-clock-as-UTC space as its stored dates.
 * Expected behaviour: 5 Nov 00:00 and 23:59:59 map to `Date.UTC(2026, 10, 5)`
 * seconds at any device offset, east or west of Greenwich.
 */
import { localDayEndEpochSeconds, localDayStartEpochSeconds } from '@/shared/time/startDate';
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
