/**
 * Scenario: the insights compute reads a wellness window that two callers own.
 * Expected behaviour: it reads the rows without reordering the caller's array,
 * and the background task asks for the same local-dated window the foreground
 * does.
 *
 * The array the foreground passes is the TanStack cache's own, so sorting it in
 * place reorders what every other consumer of that query sees.
 */

import {
  computeInsightsFromData,
  type WellnessInput,
} from '@/features/insights/lib/computeInsightsData';
import { wellnessWindow } from '@/features/insights/lib/wellnessWindow';
import type { InsightsData } from 'veloqrs';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn(() => null) }));
jest.mock('@/features/routes/stores/RouteSettingsStore', () => ({
  isRouteMatchingEnabled: jest.fn(() => false),
}));

const t = (key: string) => key;

function makePeriod(count: number) {
  return { count, totalDuration: BigInt(3600), totalDistance: 10_000, totalTss: 60 };
}

function buildFfiData(): InsightsData {
  return {
    currentWeek: makePeriod(3),
    previousWeek: makePeriod(2),
    chronicPeriod: makePeriod(12),
    todayPeriod: makePeriod(0),
    allPatterns: [],
    recentPrs: [],
    sectionCount: 0,
    sportTypes: ['Ride'],
    rankedSections: [],
    efficiencyTrends: [],
    hasStrengthData: false,
  } as unknown as InsightsData;
}

describe('the wellness window the insights read', () => {
  it('leaves the caller its own row order', () => {
    const wellness: WellnessInput[] = [
      { id: '2026-09-03', ctl: 50, atl: 40 },
      { id: '2026-09-01', ctl: 30, atl: 20 },
      { id: '2026-09-02', ctl: 40, atl: 30 },
    ];

    computeInsightsFromData(buildFfiData(), wellness, t);

    expect(wellness.map((row) => row.id)).toEqual(['2026-09-03', '2026-09-01', '2026-09-02']);
  });

  it('still reads the newest row when the caller hands them unsorted', () => {
    const wellness: WellnessInput[] = [
      { id: '2026-09-01', ctl: 30, atl: 20 },
      { id: '2026-09-03', ctl: 50, atl: 40 },
      { id: '2026-09-02', ctl: 40, atl: 30 },
    ];

    expect(() => computeInsightsFromData(buildFfiData(), wellness, t)).not.toThrow();
    expect(wellness[0].id).toBe('2026-09-01');
  });
});

/**
 * Jest sandboxes `process.env`, so assigning TZ here never reaches Node's own
 * timezone cache and the test cannot choose its zone. It picks the local time
 * of day whose UTC spelling falls on the day before instead, which is 00:30
 * east of UTC and 23:30 west of it. Only on UTC itself do the two spellings
 * agree, and there the defect has nothing to show.
 */
const EAST_OF_UTC = new Date(2026, 8, 12, 12, 0).getTimezoneOffset() <= 0;
const NOW = EAST_OF_UTC ? new Date(2026, 8, 12, 0, 30) : new Date(2026, 8, 12, 23, 30);

describe('wellnessWindow', () => {
  it('dates the window locally, so today is in it whatever the zone', () => {
    expect(wellnessWindow(NOW, 30).newest).toBe('2026-09-12');
  });

  it('reaches back the window it is given', () => {
    expect(wellnessWindow(NOW, 30).oldest).toBe('2026-08-13');
  });
});
