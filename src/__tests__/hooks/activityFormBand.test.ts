/**
 * Scenario: one athlete, one day, one TSB, shown on the fitness tab and on the
 * activity card.
 * Expected behaviour: the card shows the zone and the text the engine states
 * for the day, names the zone in words rather than tinting itself, and draws
 * nothing for a day with no stated form. A card with no wellness shows no
 * form stat at all.
 */

import { renderHook } from '@testing-library/react-native';

import { useActivityStats } from '@/features/activity/components/stats/useActivityStats';
import { formZoneLabel } from '@/features/fitness/lib/fitness';
import type { StatDetail } from '@/features/activity/components/stats/types';
import type { WellnessData } from '@/types';
import { FfiMaxHrSource } from 'veloqrs';
import { activityRecord } from '../__shared__/activityRecord';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysWithValues());

const activity = activityRecord({
  id: 'a1',
  sportType: 'Ride',
  name: 'Ride',
  startDateLocal: '2026-09-05T08:00:00',
});

// The athlete's own max, the source a percent of max was once graded against.
const settings = { isMetric: true, maxHR: 185, maxHrSource: FfiMaxHrSource.SportSettings };

async function formStat(wellness?: WellnessData) {
  const { result } = await renderHook(() => useActivityStats({ activity, wellness, ...settings }));
  return result.current.stats.find((s) => s.title === 'activity.stats.yourForm');
}

describe('the activity card form band', () => {
  const stated = (over: Partial<WellnessData>) =>
    ({ id: '2026-09-05', ctl: 50, atl: 45, ...over }) as WellnessData;

  it('prints the form, zone and absolute TSB exactly as the engine stated them', async () => {
    const stat = await formStat(
      stated({ form: 11, formZone: 'fresh', formText: '+22%', tsbText: '+11' })
    );
    expect(stat?.value).toBe('+22%');
    expect(stat?.context).toBe(formZoneLabel('fresh'));
    const details = Object.fromEntries(stat!.details!.map((d) => [d.label, d.value]));
    expect(details['activity.stats.formTSB']).toBe('+11');
    expect(stat?.stream).toBeUndefined();
  });

  it('draws no value and names no zone on a day the engine states no form for', async () => {
    const stat = await formStat(stated({}));
    expect(stat).toBeDefined();
    expect(stat?.value).toBe('');
    expect(stat?.context).toBeUndefined();
  });

  it.each(['highRisk', 'optimal', 'greyZone', 'fresh', 'transition'] as const)(
    'names the %s zone in words',
    async (zone) => {
      const stat = await formStat(stated({ formZone: zone, formText: '0' }));
      expect(stat?.context).toBe(formZoneLabel(zone));
    }
  );

  it('shows no form stat without wellness', async () => {
    expect(await formStat(undefined)).toBeUndefined();
    expect(await formStat({ ctl: 50 } as WellnessData)).toBeUndefined();
  });
});

/**
 * Expected behaviour: the training load, heart rate and conditions cards show
 * the number and nothing the app judges about it. None tints itself by its
 * value, heart rate is keyed to its stream alone, and the load card states the
 * intensity factor without a band word.
 */
describe('a card grades nothing the data source does not', () => {
  async function stats(fields: Parameters<typeof activityRecord>[0]) {
    const { result } = await renderHook(() =>
      useActivityStats({ activity: activityRecord({ ...activity, ...fields }), ...settings })
    );
    return result.current.stats;
  }
  const titled = async (title: string, fields: Parameters<typeof activityRecord>[0]) =>
    (await stats(fields)).find((s) => s.title === title);
  // Everything a card could tint itself with: its stream key and any colour value.
  const marks = (stat: StatDetail | undefined) => [
    stat?.stream,
    ...Object.values(stat ?? {}).filter((v) => typeof v === 'string' && v.startsWith('#')),
  ];

  it('omits intensity when a stored activity has load but no intensity', async () => {
    const stat = await titled('metrics.trainingLoad', { trainingLoad: 60 });

    expect(stat?.value).toBe('60');
    expect(stat?.context).toBeUndefined();
    expect(
      stat?.details?.find((detail) => detail.label === 'activity.stats.intensityFactor')
    ).toBeUndefined();
  });

  vaultIt('tints training load at no intensity', async () => {
    for (const intensity of [undefined, 0, 60, 78, 92, 100, 105, 140]) {
      const stat = await titled('metrics.trainingLoad', {
        trainingLoad: 60,
        intensity,
      });
      expect(stat).toBeDefined();
      expect(marks(stat)).toEqual([undefined]);
    }
  });

  vaultIt.each([0, 60, 70, 78, 85, 92, 100, 105])(
    'states an IF of %d with no band word',
    async (intensity) => {
      const stat = await titled('metrics.trainingLoad', {
        trainingLoad: 60,
        intensity,
      });
      expect(stat?.context).toBe(
        `activity.stats.intensityContext:${JSON.stringify({ percent: `${intensity}%` })}`
      );
    }
  );

  vaultIt('keys heart rate to its stream alone at every share of max', async () => {
    for (const share of [0.5, 0.6, 0.8, 0.81, 0.9, 0.95, 1.05]) {
      const stat = await titled('activity.heartRate', {
        avgHr: Math.round(settings.maxHR * share),
      });
      expect(marks(stat)).toEqual(['heartrate']);
    }
  });

  vaultIt('tints conditions at no temperature', async () => {
    for (const temp of [-10, 0, 9, 10, 20, 28, 29, 40]) {
      const stat = await titled('activity.stats.conditions', { sensorTemp: temp });
      expect(stat).toBeDefined();
      expect(marks(stat)).toEqual([undefined]);
    }
  });
});
