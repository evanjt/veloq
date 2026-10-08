/**
 * Scenario: the route performance read returns attempts in the section chart's
 * shape, one of them outside the band around the route's usual distance and
 * each carrying how much of the route it matched.
 *
 * Expected behaviour: the chart points carry the band flag, the match and the
 * engine's record stamp as read, counted and excluded alike, so the scatter's
 * band styling and match tooltip come from the engine.
 */

import { renderHook } from '@testing-library/react-native';
import { useSectionChartData } from '@/features/routes/hooks/useSectionChartData';
import { useSectionChartDataEnriched } from '@/features/routes/hooks/useSectionChartDataEnriched';
import type { FfiSectionChartData, FfiSectionChartPoint } from 'veloqrs';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn(() => null) }));

function attempt(
  activityId: string,
  overrides: Partial<FfiSectionChartPoint> = {}
): FfiSectionChartPoint {
  return {
    lapId: activityId,
    activityId,
    activityName: activityId,
    activityDate: 1_790_000_000,
    speed: 6,
    sectionTime: 1500,
    sectionDistance: 9000,
    direction: 'same',
    isBest: false,
    outsideDistanceBand: false,
    matchPercentage: 96,
    ...overrides,
  };
}

function chart(points: FfiSectionChartPoint[]): FfiSectionChartData {
  return {
    points,
    minSpeed: 5,
    maxSpeed: 7,
    hasReverseRuns: false,
    totalActivities: points.length,
  };
}

describe('route attempts on the chart', () => {
  it('carries the band flag, the match and the record stamp of each counted attempt', () => {
    const { result } = renderHook(() =>
      useSectionChartData({
        preComputedChart: chart([
          attempt('dune-loop-1', { isBest: true, matchPercentage: 99 }),
          attempt('dune-loop-detour', { outsideDistanceBand: true, matchPercentage: 71 }),
        ]),
      })
    );

    expect(
      result.current.chartData.map((p) => [
        p.activityId,
        p.isBest,
        p.outsideDistanceBand,
        p.matchPercentage,
      ])
    ).toEqual([
      ['dune-loop-1', true, false, 99],
      ['dune-loop-detour', false, true, 71],
    ]);
  });

  it('leaves the match absent for a section lap, which has none', () => {
    const lap = attempt('ridge-climb');
    delete lap.matchPercentage;
    const { result } = renderHook(() => useSectionChartData({ preComputedChart: chart([lap]) }));

    expect(result.current.chartData[0].matchPercentage).toBeUndefined();
    expect(result.current.chartData[0].outsideDistanceBand).toBe(false);
  });

  it('carries the band flag and the match onto a shown excluded attempt', () => {
    const { result } = renderHook(() =>
      useSectionChartDataEnriched({
        chartData: [],
        showExcluded: true,
        excludedPoints: [
          attempt('dune-loop-shortcut', { outsideDistanceBand: true, matchPercentage: 64 }),
        ],
        preComputedCalendarSummary: null,
        bestForwardRecord: null,
        bestReverseRecord: null,
      })
    );

    expect(result.current.combinedChartData).toEqual([
      expect.objectContaining({
        activityId: 'dune-loop-shortcut',
        isExcluded: true,
        outsideDistanceBand: true,
        matchPercentage: 64,
      }),
    ]);
  });
});
