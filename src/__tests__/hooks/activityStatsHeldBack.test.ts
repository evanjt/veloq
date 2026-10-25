/**
 * Scenario: intervals.icu holds a ride but does not serve it, so its training
 * load and intensity factor arrive empty. The stats must not print a zero for
 * them.
 *
 * Expected behaviour: a held-back ride reads "Not shared by intervals.icu" for
 * its training load and its intensity factor. A ride intervals.icu serves keeps
 * its figures, and a served ride with no load draws no load card at all.
 */

import { renderHook } from '@testing-library/react-native';

import { useActivityStats } from '@/features/activity/components/stats/useActivityStats';
import { initialiseI18n, i18n } from '@/i18n';
import { activityRecord } from '../__shared__/activityRecord';

const stub = activityRecord({
  id: 'stub',
  sportType: 'Ride',
  name: 'Ride',
  startDateLocal: '2026-09-05T08:00:00',
});

const served = activityRecord({
  id: 'served',
  sportType: 'Ride',
  name: 'Ride',
  startDateLocal: '2026-09-05T08:00:00',
  movingTime: 5400,
  trainingLoad: 96,
  intensity: 88,
});

const hold = { source: 'GARMIN_CONNECT', externalId: '5550001' };

function stats(activity: typeof stub, heldBack: typeof hold | null) {
  const { result } = renderHook(() => useActivityStats({ activity, isMetric: true, heldBack }));
  return result.current.stats;
}

function loadCard(found: ReturnType<typeof stats>) {
  return found.find((s) => s.title === i18n.t('metrics.trainingLoad'));
}

describe('the stats of a ride intervals.icu holds', () => {
  beforeAll(async () => {
    await initialiseI18n('en-GB');
  });

  it('reads the training load as not shared rather than zero', () => {
    const card = loadCard(stats(stub, hold));

    expect(card?.value).toBe(i18n.t('activity.heldBack.title'));
  });

  it('reads the intensity factor as not shared, in place of a figure', () => {
    const card = loadCard(stats(stub, hold));

    expect(card?.details).toContainEqual({
      label: i18n.t('activity.stats.intensityFactor'),
      value: i18n.t('activity.heldBack.title'),
    });
  });

  it('keeps the figures of a ride intervals.icu serves', () => {
    const card = loadCard(stats(served, null));

    expect(card?.value).toBe('96');
    expect(card?.details).toContainEqual({
      label: i18n.t('activity.stats.intensityFactor'),
      value: '88%',
    });
    expect(JSON.stringify(stats(served, null))).not.toContain(i18n.t('activity.heldBack.title'));
  });

  it('draws no load card for a served ride with no load, as before', () => {
    expect(loadCard(stats(stub, null))).toBeUndefined();
  });
});
