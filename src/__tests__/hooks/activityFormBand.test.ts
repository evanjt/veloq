/**
 * Scenario: one athlete, one day, one TSB, shown on the fitness tab and on the
 * activity card.
 * Expected behaviour: both surfaces colour the number from the same five-band
 * ladder, `getFormZone` and the form-zone text family, on every band and at
 * every boundary, and a card with no wellness shows no form stat at all. The
 * number is text, so it takes the text variant and not the band fill.
 */

import { renderHook } from '@testing-library/react-native';

import { useActivityStats } from '@/features/activity/components/stats/useActivityStats';
import { DEFAULT_MAX_HR } from '@/features/activity/lib/hrZones';
import { useFormPreference } from '@/shared/app/FormPreferenceStore';
import {
  getFormZone,
  FORM_ZONE_TEXT_COLORS,
  FORM_ZONE_TEXT_COLORS_DARK,
  formZoneLabel,
  type FormZone,
} from '@/features/fitness/lib/fitness';
import type { Activity, WellnessData } from '@/types';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

const activity = {
  id: 'a1',
  type: 'Ride',
  name: 'Ride',
  start_date_local: '2026-09-05T08:00:00',
} as Activity;

const settings = { isMetric: true, maxHR: DEFAULT_MAX_HR };

function formStat(wellness?: WellnessData, isDark = false) {
  const { result } = renderHook(() =>
    useActivityStats({ activity, wellness, isDark, ...settings })
  );
  return result.current.stats.find((s) => s.title === 'activity.stats.yourForm');
}

describe('the activity card form band', () => {
  it('uses the displayed form when fractional loads round across a zone boundary', () => {
    const stat = formStat({ ctl: 50.5, atl: 45.6 } as WellnessData);
    expect(stat?.value).toBe('+5');
    expect(stat?.context).toBe(formZoneLabel('fresh'));
    expect(stat?.color).toBe(FORM_ZONE_TEXT_COLORS.fresh);
  });

  it('uses rounded fitness to zone the displayed percentage', () => {
    useFormPreference.getState().setFormAsPercent(true);
    try {
      const stat = formStat({ ctl: 100.49, atl: 95.49 } as WellnessData);
      expect(stat?.value).toBe('+5%');
      expect(stat?.color).toBe(FORM_ZONE_TEXT_COLORS.fresh);
    } finally {
      useFormPreference.setState({ formAsPercent: null });
    }
  });

  it.each([-35, -30, -20, -10, -5, 0, 5, 10, 25, 30])(
    'colours a TSB of %d from the fitness ladder',
    (tsb) => {
      const stat = formStat({ ctl: 50, atl: 50 - tsb } as WellnessData);
      expect(stat).toBeDefined();
      expect(stat?.color).toBe(FORM_ZONE_TEXT_COLORS[getFormZone(tsb) as FormZone]);

      const dark = formStat({ ctl: 50, atl: 50 - tsb } as WellnessData, true);
      expect(dark?.color).toBe(FORM_ZONE_TEXT_COLORS_DARK[getFormZone(tsb) as FormZone]);
    }
  );

  it('shows no form stat without wellness', () => {
    expect(formStat(undefined)).toBeUndefined();
    expect(formStat({ ctl: 50 } as WellnessData)).toBeUndefined();
  });
});

/**
 * Expected behaviour: the form card names the zone its colour shows, so the
 * zone never reaches the athlete through hue alone.
 */
describe('the form card names its zone', () => {
  it.each([-35, -20, 0, 10, 30])('names the form zone at a TSB of %d', (tsb) => {
    const stat = formStat({ ctl: 50, atl: 50 - tsb } as WellnessData);
    expect(stat?.context).toBe(formZoneLabel(getFormZone(tsb) as FormZone));
  });
});

/**
 * Expected behaviour: the training load, heart rate and conditions cards show
 * the number and nothing the app judges about it. Each takes one colour
 * whatever the value, and the load card states the intensity factor without a
 * band word.
 */
describe('a card grades nothing the data source does not', () => {
  function stats(fields: Partial<Activity>, isDark = false) {
    const { result } = renderHook(() =>
      useActivityStats({ activity: { ...activity, ...fields } as Activity, isDark, ...settings })
    );
    return result.current.stats;
  }
  const titled = (title: string, fields: Partial<Activity>, isDark = false) =>
    stats(fields, isDark).find((s) => s.title === title);

  it('omits intensity when a stored activity has load but no intensity', () => {
    const stat = titled('activity.stats.trainingLoad', { icu_training_load: 60 });

    expect(stat?.value).toBe('60');
    expect(stat?.context).toBeUndefined();
    expect(
      stat?.details?.find((detail) => detail.label === 'activity.stats.intensityFactor')
    ).toBeUndefined();
  });

  it.each([false, true])('colours training load the same at every intensity (dark %s)', (dark) => {
    const colours = [undefined, 0, 60, 78, 92, 100, 105, 140].map(
      (intensity) =>
        titled(
          'activity.stats.trainingLoad',
          { icu_training_load: 60, icu_intensity: intensity },
          dark
        )?.color
    );
    expect(colours[0]).toBeDefined();
    expect(new Set(colours).size).toBe(1);
  });

  it.each([0, 60, 70, 78, 85, 92, 100, 105])(
    'states an IF of %d with no band word',
    (intensity) => {
      const stat = titled('activity.stats.trainingLoad', {
        icu_training_load: 60,
        icu_intensity: intensity,
      });
      expect(stat?.context).toBe(`IF ${intensity}%`);
    }
  );

  it.each([false, true])('colours heart rate the same at every share of max (dark %s)', (dark) => {
    const colours = [0.5, 0.6, 0.8, 0.81, 0.9, 0.95, 1.05].map(
      (share) =>
        titled(
          'activity.heartRate',
          { average_heartrate: Math.round(settings.maxHR * share) },
          dark
        )?.color
    );
    expect(colours[0]).toBeDefined();
    expect(new Set(colours).size).toBe(1);
  });

  it.each([false, true])('colours conditions the same at every temperature (dark %s)', (dark) => {
    const colours = [-10, 0, 9, 10, 20, 28, 29, 40].map(
      (temp) => titled('activity.stats.conditions', { average_temp: temp }, dark)?.color
    );
    expect(colours[0]).toBeDefined();
    expect(new Set(colours).size).toBe(1);
  });
});
