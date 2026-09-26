/**
 * Scenario: form is fitness, fatigue and the difference, and both callers were
 * reading a month of wellness rows out of the engine to reduce them to those
 * three numbers.
 *
 * Expected behaviour: the bundle carries form, the window it is read from is a
 * parameter of the bundle, and that window is dated locally so today is in it
 * whatever the zone.
 */

import { computeInsightsFromData } from '@/features/insights/lib/computeInsightsData';
import { wellnessWindow } from '@/features/insights/lib/wellnessWindow';
import { buildInsightsParams } from '@/features/insights/lib/insightsParams';
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

describe('the form the insights read', () => {
  it('reads it off the bundle rather than from rows a caller hands in', () => {
    const data = {
      ...buildFfiData(),
      form: { date: '2026-09-12', ctl: 50, atl: 40, tsb: 10 },
    } as unknown as InsightsData;

    expect(() => computeInsightsFromData(data, t)).not.toThrow();
  });

  it('asks the engine for a window ending today', () => {
    const params = buildInsightsParams();

    expect(params.wellnessNewest).toBe(wellnessWindow(new Date(), 30).newest);
    expect(params.wellnessOldest).toBe(wellnessWindow(new Date(), 30).oldest);
  });

  it('carries no form for a window the engine found no day in', () => {
    const data = { ...buildFfiData(), form: undefined } as unknown as InsightsData;

    expect(computeInsightsFromData(data, t)).toEqual([]);
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
