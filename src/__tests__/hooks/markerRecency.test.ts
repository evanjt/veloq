/**
 * Scenario: each map marker fades with the age of its ride.
 *
 * Expected behaviour: the age is the elapsed time in years between two
 * wall-clock stamps, capped at one. Both sides are wall-clock seconds, so the
 * gap is the athlete's time and no device offset enters it.
 */

import { recencyAge } from '@/features/maps/components/regional/useMapGeoJSON';
import { localWallClockToEpochSeconds } from '@/shared/time/startDate';

const DAY = 86_400;
const YEAR = 365 * DAY;

describe('recencyAge', () => {
  const now = localWallClockToEpochSeconds(new Date(2026, 10, 9, 10, 0));

  it('reads a ride stamped now as brand new', () => {
    expect(recencyAge(now, now)).toBe(0);
  });

  it('reads a ride from half a year back as half a year old', () => {
    expect(recencyAge(now - YEAR / 2, now)).toBeCloseTo(0.5, 12);
  });

  it('caps a ride older than a year at one', () => {
    expect(recencyAge(now - 3 * YEAR, now)).toBe(1);
  });

  it('reads a ride from the day before as one day old', () => {
    expect(recencyAge(now - DAY, now)).toBeCloseTo(DAY / YEAR, 12);
  });
});
