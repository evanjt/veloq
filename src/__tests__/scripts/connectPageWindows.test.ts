/**
 * Scenario: the connect page names windows (export since, the map's span) that the
 * engine compares against activity dates stored as wall clock stamped as UTC.
 *
 * Expected behaviour: a bound is the calendar day stamped as UTC whatever the
 * browser's offset, so a ride on the first day of a window is never cut.
 */

import { sinceOf } from '../../../web/connect/ExportPane';
import { windowFor } from '../../../web/connect/map/MapScreen';
import { getPeriodStart } from '@/features/maps/lib/mapPeriod';
import { atUtcOffset } from '../__shared__/fixedOffsetDate';

describe.each([10, -5])('windows at UTC%+d', (offsetHours) => {
  it('reads an export since date as midnight of that day in the engine date space', () => {
    expect(atUtcOffset(offsetHours, () => sinceOf('2026-03-01'))).toBe(Date.UTC(2026, 2, 1) / 1000);
    expect(atUtcOffset(offsetHours, () => sinceOf('nope'))).toBeNull();
  });

  it('ends an open map window a day past the wall clock now', () => {
    const end = atUtcOffset(
      offsetHours,
      () => windowFor({ range: null } as never, new Date(2026, 10, 12, 21, 30)).endDate
    );
    expect(end).toBe(Date.UTC(2026, 10, 12, 21, 30) / 1000 + 86_400);
  });

  it('starts the map year on 1 January and a rolling span a whole span back, in that space', () => {
    const [year, week] = atUtcOffset(offsetHours, () => {
      const now = new Date(2026, 10, 12, 21, 30);
      return [getPeriodStart('year', now), getPeriodStart('7d', now)];
    });
    expect(year.getTime()).toBe(Date.UTC(2026, 0, 1));
    expect(week.getTime()).toBe(Date.UTC(2026, 10, 5, 21, 30));
  });
});
