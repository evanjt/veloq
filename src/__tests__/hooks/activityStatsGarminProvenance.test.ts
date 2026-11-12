/**
 * Scenario: a ride read from a Garmin file has its load, intensity and zones
 * worked out by Veloq, and has no strain, heart rate recovery or weather,
 * which only intervals.icu supplies.
 *
 * Expected behaviour: on a Garmin source the training load card says Veloq
 * worked it out, and strain, heart rate recovery and weather each name
 * intervals.icu as the missing source. On an intervals.icu source the stats
 * carry neither the line nor the causes.
 */

import { act, renderHook } from '@testing-library/react-native';

import { useActivityStats } from '@/features/activity/components/stats/useActivityStats';
import { useAuthStore } from '@/shared/app/AuthStore';
import { initialiseI18n, i18n } from '@/i18n';
import { activityRecord } from '../__shared__/activityRecord';

const ride = activityRecord({
  id: 'g1',
  sportType: 'Ride',
  name: 'Ride',
  startDateLocal: '2026-09-05T08:00:00',
  movingTime: 5400,
  trainingLoad: 96,
  avgHr: 140,
});

function stats(activity = ride) {
  const { result } = renderHook(() => useActivityStats({ activity, isMetric: true }));
  return result.current.stats;
}

const needs = () => i18n.t('activity.stats.needsIntervals');

describe('the stats of a ride on a Garmin source', () => {
  beforeAll(async () => {
    await initialiseI18n('en-GB');
  });

  afterEach(() => {
    act(() => useAuthStore.setState({ authMethod: null }));
  });

  it('says Veloq worked out the training load', () => {
    act(() => useAuthStore.setState({ authMethod: 'garmin' }));
    const card = stats().find((s) => s.title === i18n.t('metrics.trainingLoad'));

    expect(card?.provenance).toBe(i18n.t('activity.provenance.veloqNumbers'));
  });

  it('names intervals.icu as the cause for strain, heart rate recovery and weather', () => {
    act(() => useAuthStore.setState({ authMethod: 'garmin' }));
    const found = stats();
    const load = found.find((s) => s.title === i18n.t('metrics.trainingLoad'));
    const heart = found.find((s) => s.title === i18n.t('activity.heartRate'));
    const conditions = found.find((s) => s.title === i18n.t('activity.stats.conditions'));

    expect(load?.details).toContainEqual({
      label: i18n.t('activity.stats.strain'),
      value: needs(),
    });
    expect(heart?.details).toContainEqual({
      label: i18n.t('activity.stats.hrRecovery'),
      value: needs(),
    });
    expect(conditions?.details).toContainEqual({
      label: i18n.t('activity.stats.conditions'),
      value: needs(),
    });
  });

  it('keeps the figures it has, in place of the cause', () => {
    act(() => useAuthStore.setState({ authMethod: 'garmin' }));
    const found = stats(
      activityRecord({
        ...ride,
        strainScore: 12,
        hrRecovery: 30,
        weatherTemp: 18,
        hasWeather: true,
      })
    );

    expect(JSON.stringify(found)).not.toContain(needs());
  });

  it('shows neither the line nor the causes on an intervals.icu source', () => {
    act(() => useAuthStore.setState({ authMethod: 'oauth' }));
    const found = stats();

    expect(JSON.stringify(found)).not.toContain(needs());
    expect(found.some((s) => s.provenance != null)).toBe(false);
  });
});
