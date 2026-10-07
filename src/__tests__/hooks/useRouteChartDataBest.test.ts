/**
 * Scenario: the route chart's ring and tooltip trophy follow the record the
 * engine stamped on each performance, not a fastest-time pick made here.
 *
 * Expected behaviour: the ring lands on the stamped attempt, a tie or lone
 * attempt (stamped on nothing) rings nothing, and the tooltip marks only the
 * stamped attempts, one per direction.
 */

import { renderHook } from '@testing-library/react-native';
import { useRouteChartData } from '@/features/routes/hooks/useRouteChartData';
import type { RoutePerformancePoint } from '@/features/routes/hooks/useRoutePerformances';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn(() => null) }));

function point(
  activityId: string,
  direction: string,
  duration: number,
  isRecord = false
): RoutePerformancePoint {
  return {
    activityId,
    name: activityId,
    date: new Date(1_700_000_000_000),
    speed: 40_000 / duration,
    duration,
    movingTime: duration,
    direction,
    matchPercentage: 95,
    isRecord,
  } as unknown as RoutePerformancePoint;
}

function render(performances: RoutePerformancePoint[]) {
  return renderHook(() => useRouteChartData(performances, null, []));
}

describe('useRouteChartData record stamp', () => {
  it('rings the stamped attempt even when another is faster', () => {
    const { result } = render([point('quick', 'same', 600), point('stamped', 'same', 700, true)]);
    expect(result.current.bestIndex).toBe(1);
    expect(result.current.chartData.map((p) => p.isBest)).toEqual([false, true]);
  });

  it('rings nothing when no attempt is stamped, as with a tie or a lone attempt', () => {
    const { result } = render([point('a', 'same', 600), point('b', 'same', 600)]);
    expect(result.current.bestIndex).toBe(-1);
    expect(result.current.chartData.every((p) => p.isBest === false)).toBe(true);
  });

  it('marks one attempt per direction and rings the forward one', () => {
    const { result } = render([
      point('rev', 'reverse', 500, true),
      point('fwd', 'same', 600, true),
      point('slow', 'same', 700),
    ]);
    expect(result.current.chartData.map((p) => p.isBest)).toEqual([true, true, false]);
    expect(result.current.bestIndex).toBe(1);
  });

  it('rings the reverse attempt when only it is stamped', () => {
    const { result } = render([point('fwd', 'same', 600), point('rev', 'reverse', 500, true)]);
    expect(result.current.bestIndex).toBe(1);
  });

  it('never rings a partial traversal, which is not plotted', () => {
    const { result } = render([point('part', 'partial', 400, true), point('fwd', 'same', 600)]);
    expect(result.current.bestIndex).toBe(-1);
  });
});

describe('useRouteChartData outside-band flag', () => {
  it('carries the flag onto the plotted point', () => {
    const inside = point('inside', 'same', 700);
    const shortcut = { ...point('shortcut', 'same', 500), outsideDistanceBand: true };
    const { result } = renderHook(() => useRouteChartData([inside, shortcut], null, []));
    const byId = Object.fromEntries(
      result.current.chartData.map((d) => [d.activityId, d.outsideDistanceBand])
    );
    expect(byId.shortcut).toBe(true);
    expect(byId.inside).toBeFalsy();
  });
});

describe('useRouteChartData tooltip reference', () => {
  const best = (bestTime: number, bestSpeed: number) => ({
    bestTime,
    bestSpeed,
    activityDate: new Date(1_700_000_000_000),
  });

  it('measures every attempt against the engine best, not a faster out-of-band one', () => {
    const shortcut = { ...point('shortcut', 'same', 1120), outsideDistanceBand: true };
    const performances = [
      shortcut,
      point('record', 'same', 1200, true),
      point('later', 'same', 1210),
    ];
    const engineBest = { forward: best(1200, 40_000 / 1200), reverse: null };
    const { result } = renderHook(() =>
      useRouteChartData(performances, null, [], undefined, engineBest)
    );
    const later = result.current.chartData.find((d) => d.activityId === 'later');
    expect(later?.bestTime).toBe(1200);
    expect(later?.bestSpeed).toBeCloseTo(40_000 / 1200);
  });

  it('carries no reference for a direction the engine has no best for', () => {
    const performances = [point('fwd', 'same', 1200), point('rev', 'reverse', 1300)];
    const engineBest = { forward: best(1200, 40_000 / 1200), reverse: null };
    const { result } = renderHook(() =>
      useRouteChartData(performances, null, [], undefined, engineBest)
    );
    const byId = Object.fromEntries(result.current.chartData.map((d) => [d.activityId, d]));
    expect(byId.fwd?.bestTime).toBe(1200);
    expect(byId.rev?.bestTime).toBeUndefined();
    expect(byId.rev?.bestSpeed).toBeUndefined();
  });

  it('carries no reference when no engine bests are passed', () => {
    const { result } = render([point('a', 'same', 600)]);
    expect(result.current.chartData[0]?.bestTime).toBeUndefined();
  });
});
