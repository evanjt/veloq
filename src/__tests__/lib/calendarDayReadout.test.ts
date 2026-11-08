/**
 * Scenario: a day selected on the calendar grid states the load figures and
 * each wellness value the athlete logged that day.
 *
 * Expected behaviour: form is fitness less fatigue, only logged values are
 * listed, in a fixed order, and a day with no stored row states none.
 */

import { calendarDayReadout } from '@/features/fitness/lib/calendarDayReadout';
import type { WellnessData } from '@/types';

const day = (over: Partial<WellnessData>): WellnessData =>
  ({ id: '2026-06-10', ...over }) as WellnessData;

describe('calendarDayReadout', () => {
  it('derives form from fitness and fatigue and lists the logged values in order', () => {
    const readout = calendarDayReadout(
      day({ ctl: 50.4, atl: 60.2, weight: 70, hrv: 62, restingHR: 48, sleepSecs: 7.5 * 3600 })
    );

    expect(readout).toEqual({
      fitness: 50.4,
      fatigue: 60.2,
      form: expect.closeTo(-9.8, 5),
      logged: [
        { metric: 'hrv', value: 62 },
        { metric: 'restingHR', value: 48 },
        { metric: 'sleepSecs', value: 7.5 * 3600 },
        { metric: 'weight', value: 70 },
      ],
    });
  });

  it('states no form when either load figure is missing, and no values for an unlogged day', () => {
    expect(calendarDayReadout(day({ ctl: 40 }))).toEqual({
      fitness: 40,
      fatigue: null,
      form: null,
      logged: [],
    });
  });

  it('answers null for a day with no stored row', () => {
    expect(calendarDayReadout(undefined)).toBeNull();
  });
});
