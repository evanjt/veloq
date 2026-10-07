/**
 * Scenario: a throw inside the insights pipeline came back as an empty list,
 * which the panel shows as the empty-library hint, and nothing was logged.
 *
 * Expected behaviour: a throw is a distinguishable failure that is logged, and
 * one bad polyline drops one card rather than the whole list.
 */

import { computeInsightsFromData } from '@/features/insights/lib/computeInsightsData';
import { decodeCoords } from 'veloqrs';
import type { InsightsData } from 'veloqrs';

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({ decodeCoords: jest.fn() })
);
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn(() => null) }));
jest.mock('@/features/routes/stores/RouteSettingsStore', () => ({
  isRouteMatchingEnabled: jest.fn(() => true),
}));

const t = (key: string) => key;

function period(count: number) {
  return { count, totalDuration: BigInt(3600), totalDistance: 10_000, totalTss: 60 };
}

function pr(sectionId: string) {
  return {
    sectionId,
    sectionName: sectionId,
    bestTime: 100,
    daysAgo: 1,
    sportType: 'Ride',
    traversalCount: 5,
    recentEfforts: [],
    encodedPolyline: sectionId,
  };
}

function data(overrides: Record<string, unknown> = {}): InsightsData {
  return {
    currentWeek: period(3),
    previousWeek: period(2),
    chronicPeriod: period(12),
    chronicWeekAverage: period(3),
    recentPrs: [],
    sectionCount: 2,
    sportTypes: ['Ride'],
    rankedSections: [],
    efficiencyTrends: [],
    hasStrengthData: false,
    ...overrides,
  } as unknown as InsightsData;
}

describe('a throwing insights pipeline', () => {
  let errorSpy: jest.SpyInstance;
  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    (decodeCoords as jest.Mock).mockReturnValue([]);
  });
  afterEach(() => errorSpy.mockRestore());

  it('reports a failure and logs the error', () => {
    const broken = data({ currentWeek: null });

    const result = computeInsightsFromData(broken, t, null);

    expect(result.failed).toBe(true);
    expect(result.insights).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('reports no failure for an empty library', () => {
    expect(computeInsightsFromData(data(), t, null).failed).toBe(false);
    expect(computeInsightsFromData(null, t, null)).toEqual({ insights: [], failed: false });
  });

  it('drops the one record whose polyline will not decode', () => {
    (decodeCoords as jest.Mock).mockImplementation((p: string) => {
      if (p === 'bad') throw new Error('bad polyline');
      return [{ latitude: 1, longitude: 2 }];
    });
    const input = data({ recentPrs: [pr('bad'), pr('good')] });

    const result = computeInsightsFromData(input, t, null);

    expect(result.failed).toBe(false);
    const ids = result.insights.map((i) => i.id).join(',');
    expect(ids).toContain('good');
    expect(ids).not.toContain('bad');
  });
});
