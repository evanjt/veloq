/**
 * Scenario: an athlete whose app language is German opens a ride whose stat cards print
 * percentages of max heart rate, of FTP, of the training load's intensity and of new ground.
 *
 * Expected behaviour: each percentage is written by the locale percent formatter, so it carries
 * the locale's spacing like the other figures on the card, and no card joins a literal percent
 * sign to a number.
 */

import { renderHook } from '@testing-library/react-native';

import { useActivityStats } from '@/features/activity/components/stats/useActivityStats';
import { formatPercent } from '@/shared/format';
import { MaxHrSource } from 'veloqrs';

import { activityRecord } from '../__shared__/activityRecord';

let mockLocale = 'en-GB';
jest.mock('@/i18n', () => ({
  ...jest.requireActual('@/i18n'),
  getCurrentLanguage: () => mockLocale,
}));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysWithValues());

afterEach(() => {
  mockLocale = 'en-GB';
});

const ride = activityRecord({
  id: 'a1',
  sportType: 'Ride',
  name: 'Ride',
  startDateLocal: '2026-09-05T08:00:00',
  avgHr: 150,
  avgPower: 220,
  ftp: 250,
  intensity: 85,
  trainingLoad: 90,
});

async function statsOf(
  maxHR?: number,
  newGround?: { fraction: number; tiles: number; newTiles: number }
) {
  const { result } = await renderHook(() =>
    useActivityStats({
      activity: ride,
      isMetric: true,
      maxHR,
      maxHrSource: MaxHrSource.SportSettings,
      newGround,
    })
  );
  return result.current.stats;
}

type Stats = Awaited<ReturnType<typeof statsOf>>;

function rowValue(stats: Stats, label: string) {
  return stats.flatMap((card) => card.details ?? []).find((row) => row.label === label)?.value;
}

describe('the percentages on the stat cards under de-DE', () => {
  beforeEach(() => {
    mockLocale = 'de-DE';
  });

  vaultIt('writes the heart rate percentage of max through the locale formatter', async () => {
    const stats = await statsOf(175);
    expect(rowValue(stats, 'activity.stats.percentOfMaxHRLabel')).toBe(formatPercent(86));
  });

  vaultIt('writes the percentage of FTP through the locale formatter', async () => {
    const stats = await statsOf();
    expect(rowValue(stats, 'activity.stats.percentOfFTP')).toBe(formatPercent(88));
  });

  vaultIt('writes the intensity factor through the locale formatter', async () => {
    const stats = await statsOf();
    expect(rowValue(stats, 'activity.stats.intensityFactor')).toBe(formatPercent(85));
  });

  it('floors the new ground share through the locale formatter', async () => {
    const stats = await statsOf(undefined, { fraction: 0.876, tiles: 8, newTiles: 7 });
    const card = stats.find((stat) => stat.title === 'activity.stats.newGround');
    expect(card?.value).toBe(formatPercent(87));
  });

  vaultIt(
    'hands the max heart rate context a formatted percentage and the template adds no sign',
    async () => {
      const stats = await statsOf(175);
      const heartRate = stats.find((stat) => stat.title === 'activity.heartRate');
      expect(heartRate?.context).toBe(
        `activity.stats.percentOfMaxHR:${JSON.stringify({ percent: formatPercent(86, 0) })}`
      );
    }
  );
});
