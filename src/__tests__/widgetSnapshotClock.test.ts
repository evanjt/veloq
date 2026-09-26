/**
 * Scenario: the impact block ages a ride by comparing the activity's date,
 * which is a zoneless wall clock, against `nowSeconds`, which is a true
 * instant. East of Greenwich the ride then reads as being in the future and
 * the block vanishes for as many hours as the offset; west of it the label
 * reads "Yesterday" for a ride taken today.
 *
 * Expected behaviour: the age is measured in the same clock the activity is
 * recorded in, so an offset changes nothing about what the widget shows.
 */

import { composeSnapshot, type RawWidgetData } from '@/features/home/lib/widgetSnapshot';
import { localWallClockToEpochSeconds } from '@/shared/time/startDate';

const series = (last: number) => [last - 2, last - 1, last];

/** A ride an hour ago, seen from a device `offsetHours` east of Greenwich. */
function raw(offsetHours: number): RawWidgetData {
  // The device's local wall clock, and the true instant that produces it.
  const localNow = new Date(Date.UTC(2026, 8, 12, 10, 0, 0));
  const trueNow = Math.floor(localNow.getTime() / 1000) - offsetHours * 3600;
  const rideLocal = new Date(Date.UTC(2026, 8, 12, 9, 0, 0));

  return {
    sparklines: { fitness: series(50), fatigue: series(40), form: series(10), hrv: [], rhr: [] },
    summary: null,
    latest: {
      activityId: 'i1',
      name: 'Morning Ride',
      date: Math.floor(rideLocal.getTime() / 1000),
      distance: 42_100,
      movingTime: 5660,
      trainingLoad: 62,
      sportType: 'Ride',
    },
    locale: 'en-AU',
    isMetric: true,
    nowSeconds: trueNow,
    nowWallSeconds: localWallClockToEpochSeconds(
      new Date(
        localNow.getUTCFullYear(),
        localNow.getUTCMonth(),
        localNow.getUTCDate(),
        localNow.getUTCHours()
      )
    ),
    translate: (k: string) => k,
  } as RawWidgetData;
}

describe('the widget clock', () => {
  it('shows the impact of a ride an hour ago, east of Greenwich', () => {
    expect(composeSnapshot(raw(2)).impact).not.toBeNull();
  });

  it('shows it west of Greenwich too', () => {
    expect(composeSnapshot(raw(-8)).impact).not.toBeNull();
  });

  it('still refuses a ride older than the impact window', () => {
    const old = raw(2);
    old.latest!.date = Number(old.latest!.date) - 5 * 86_400;

    expect(composeSnapshot(old).impact).toBeNull();
  });
});
