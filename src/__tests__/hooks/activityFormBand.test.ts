/**
 * Scenario: one athlete, one day, one TSB, shown on the fitness tab and on the
 * activity card.
 * Expected behaviour: both surfaces zone the number from the same five-band
 * ladder, `getFormZone`, on every band and at every boundary, and the card
 * names the zone in words rather than tinting itself. A card with no wellness
 * shows no form stat at all.
 */

import { act, renderHook } from '@testing-library/react-native';

import { useActivityStats } from '@/features/activity/components/stats/useActivityStats';
import { useFormPreference } from '@/shared/app/FormPreferenceStore';
import { getFormZone, formZoneLabel, type FormZone } from '@/features/fitness/lib/fitness';
import type { StatDetail } from '@/features/activity/components/stats/types';
import type { Activity, WellnessData } from '@/types';
import { MaxHrSource } from 'veloqrs';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysWithValues());

const activity = {
  id: 'a1',
  type: 'Ride',
  name: 'Ride',
  start_date_local: '2026-09-05T08:00:00',
} as Activity;

// The athlete's own max, the source a percent of max was once graded against.
const settings = { isMetric: true, maxHR: 185, maxHrSource: MaxHrSource.SportSettings };

async function formStat(wellness?: WellnessData) {
  const { result } = await renderHook(() => useActivityStats({ activity, wellness, ...settings }));
  return result.current.stats.find((s) => s.title === 'activity.stats.yourForm');
}

describe('the activity card form band', () => {
  it('uses the displayed form when fractional loads round across a zone boundary', async () => {
    const stat = await formStat({ ctl: 50.5, atl: 45.6 } as WellnessData);
    expect(stat?.value).toBe('+5');
    expect(stat?.context).toBe(formZoneLabel('fresh'));
  });

  it('uses rounded fitness to zone the displayed percentage', async () => {
    useFormPreference.getState().setFormAsPercent(true);
    try {
      const stat = await formStat({ ctl: 100.49, atl: 95.49 } as WellnessData);
      expect(stat?.value).toBe('+5%');
      expect(stat?.context).toBe(formZoneLabel('fresh'));
    } finally {
      useFormPreference.setState({ formAsPercent: null });
    }
  });

  it('follows the percentage setting when it changes after mount', async () => {
    useFormPreference.setState({ formAsPercent: false });
    try {
      const wellness = { ctl: 40, atl: 54 } as WellnessData;
      const { result } = await renderHook(() =>
        useActivityStats({ activity, wellness, ...settings })
      );
      const form = () => result.current.stats.find((s) => s.title === 'activity.stats.yourForm');
      expect(form()?.value).toBe('-14');
      expect(form()?.context).toBe(formZoneLabel('optimal'));

      await act(async () => {
        useFormPreference.getState().setFormAsPercent(true);
      });

      expect(form()?.value).toBe('-35%');
      expect(form()?.context).toBe(formZoneLabel('highRisk'));
    } finally {
      useFormPreference.setState({ formAsPercent: null });
    }
  });

  it.each([-35, -30, -20, -10, -5, 0, 5, 10, 25, 30])(
    'zones a TSB of %d from the fitness ladder',
    async (tsb) => {
      const stat = await formStat({ ctl: 50, atl: 50 - tsb } as WellnessData);
      expect(stat).toBeDefined();
      expect(stat?.context).toBe(formZoneLabel(getFormZone(tsb) as FormZone));
      expect(stat?.stream).toBeUndefined();
    }
  );

  it('shows no form stat without wellness', async () => {
    expect(await formStat(undefined)).toBeUndefined();
    expect(await formStat({ ctl: 50 } as WellnessData)).toBeUndefined();
  });
});

/**
 * Expected behaviour: the form card names its zone, so the zone reaches the
 * athlete in words.
 */
describe('the form card names its zone', () => {
  it.each([-35, -20, 0, 10, 30])('names the form zone at a TSB of %d', async (tsb) => {
    const stat = await formStat({ ctl: 50, atl: 50 - tsb } as WellnessData);
    expect(stat?.context).toBe(formZoneLabel(getFormZone(tsb) as FormZone));
  });
});

/**
 * Expected behaviour: the training load, heart rate and conditions cards show
 * the number and nothing the app judges about it. None tints itself by its
 * value, heart rate is keyed to its stream alone, and the load card states the
 * intensity factor without a band word.
 */
describe('a card grades nothing the data source does not', () => {
  async function stats(fields: Partial<Activity>) {
    const { result } = await renderHook(() =>
      useActivityStats({ activity: { ...activity, ...fields } as Activity, ...settings })
    );
    return result.current.stats;
  }
  const titled = async (title: string, fields: Partial<Activity>) =>
    (await stats(fields)).find((s) => s.title === title);
  // Everything a card could tint itself with: its stream key and any colour value.
  const marks = (stat: StatDetail | undefined) => [
    stat?.stream,
    ...Object.values(stat ?? {}).filter((v) => typeof v === 'string' && v.startsWith('#')),
  ];

  it('omits intensity when a stored activity has load but no intensity', async () => {
    const stat = await titled('metrics.trainingLoad', { icu_training_load: 60 });

    expect(stat?.value).toBe('60');
    expect(stat?.context).toBeUndefined();
    expect(
      stat?.details?.find((detail) => detail.label === 'activity.stats.intensityFactor')
    ).toBeUndefined();
  });

  it('tints training load at no intensity', async () => {
    for (const intensity of [undefined, 0, 60, 78, 92, 100, 105, 140]) {
      const stat = await titled('metrics.trainingLoad', {
        icu_training_load: 60,
        icu_intensity: intensity,
      });
      expect(stat).toBeDefined();
      expect(marks(stat)).toEqual([undefined]);
    }
  });

  it.each([0, 60, 70, 78, 85, 92, 100, 105])(
    'states an IF of %d with no band word',
    async (intensity) => {
      const stat = await titled('metrics.trainingLoad', {
        icu_training_load: 60,
        icu_intensity: intensity,
      });
      expect(stat?.context).toBe(
        `activity.stats.intensityContext:${JSON.stringify({ percent: intensity })}`
      );
    }
  );

  it('keys heart rate to its stream alone at every share of max', async () => {
    for (const share of [0.5, 0.6, 0.8, 0.81, 0.9, 0.95, 1.05]) {
      const stat = await titled('activity.heartRate', {
        average_heartrate: Math.round(settings.maxHR * share),
      });
      expect(marks(stat)).toEqual(['heartrate']);
    }
  });

  it('tints conditions at no temperature', async () => {
    for (const temp of [-10, 0, 9, 10, 20, 28, 29, 40]) {
      const stat = await titled('activity.stats.conditions', { average_temp: temp });
      expect(stat).toBeDefined();
      expect(marks(stat)).toEqual([undefined]);
    }
  });
});
