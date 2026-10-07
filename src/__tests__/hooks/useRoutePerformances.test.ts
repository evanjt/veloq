/**
 * Scenario: the route screen asks the engine which attempt on this route is the
 * fastest.
 * Expected behaviour: the engine's ruling is the answer. The hook does not
 * re-derive it from the metrics it happens to hold.
 */

import { renderHook } from '@testing-library/react-native';
import { useRoutePerformances } from '@/features/routes/hooks/useRoutePerformances';
import { getEngine } from '@/shared/native/engine';
import type {
  FfiActivityMetrics,
  FfiRouteGroup,
  FfiRoutePerformance,
  FfiRoutePerformanceResult,
} from 'veloqrs';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('@/features/routes/hooks/useEngine', () => ({
  useEngineSubscription: () => 0,
  useEngineGroups: () => ({
    groups: [
      {
        groupId: 'g1',
        activityIds: ['a1', 'a2', 'a3'],
        activityCount: 3,
        sportType: 'Ride',
      },
    ],
  }),
}));

function metrics(activityId: string, movingTime: number) {
  return {
    activityId,
    name: `Ride ${activityId}`,
    date: 1_700_000_000,
    distance: 20_000,
    movingTime,
    elapsedTime: movingTime + 60,
    elevationGain: 120,
    avgHr: 148,
    avgPower: 210,
  };
}

function performance(activityId: string, movingTime: number) {
  return {
    activityId,
    name: `Ride ${activityId}`,
    date: 1_700_000_000,
    movingTime,
    speed: 20_000 / movingTime,
    distance: 20_000,
    elevationGain: 120,
    direction: 'same',
    matchPercentage: 96,
  };
}

const getRoutePerformances = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (getEngine as jest.Mock).mockReturnValue({ getRoutePerformances });
});

it('takes the fastest attempt from the engine, not from the metrics it holds', () => {
  // 'a3' has the shortest moving time in the metrics, but the engine ruled it
  // out of the route's attempts, so it is not the best on this route.
  getRoutePerformances.mockReturnValue({
    performances: [performance('a1', 3600), performance('a2', 3300)],
    activityMetrics: [metrics('a1', 3600), metrics('a2', 3300), metrics('a3', 2400)],
    best: performance('a2', 3300),
    bestForward: performance('a2', 3300),
    bestReverse: undefined,
    forwardStats: undefined,
    reverseStats: undefined,
    currentRank: 1,
  });

  const { result } = renderHook(() => useRoutePerformances('a1', 'g1'));

  expect(result.current.best?.activityId).toBe('a2');
});

it('carries the engine verdict on whether each direction best is a record', () => {
  getRoutePerformances.mockReturnValue({
    performances: [performance('a1', 3600), performance('a2', 3300)],
    activityMetrics: [metrics('a1', 3600), metrics('a2', 3300)],
    best: performance('a2', 3300),
    bestForward: { ...performance('a2', 3300), isRecord: true },
    bestReverse: { ...performance('a1', 3600), isRecord: false },
    currentRank: 1,
  });

  const { result } = renderHook(() => useRoutePerformances('a1', 'g1'));

  expect(result.current.bestForwardIsRecord).toBe(true);
  expect(result.current.bestReverseIsRecord).toBe(false);
});

it('has no best when the engine names none', () => {
  getRoutePerformances.mockReturnValue({
    performances: [performance('a1', 3600)],
    activityMetrics: [metrics('a1', 3600)],
    best: undefined,
    bestForward: undefined,
    bestReverse: undefined,
    forwardStats: undefined,
    reverseStats: undefined,
    currentRank: undefined,
  });

  const { result } = renderHook(() => useRoutePerformances('a1', 'g1'));

  expect(result.current.performances).toHaveLength(1);
  expect(result.current.best).toBeNull();
});

it('has no best when the engine names an attempt the chart dropped', () => {
  // A zero speed cannot be plotted, so the point never enters the chart.
  getRoutePerformances.mockReturnValue({
    performances: [{ ...performance('a1', 3600), speed: 0 }, performance('a2', 3300)],
    activityMetrics: [metrics('a1', 0), metrics('a2', 3300)],
    best: performance('a1', 3600),
    bestForward: performance('a1', 3600),
    bestReverse: undefined,
    forwardStats: undefined,
    reverseStats: undefined,
    currentRank: 2,
  });

  const { result } = renderHook(() => useRoutePerformances('a1', 'g1'));

  expect(result.current.performances.map((p) => p.activityId)).toEqual(['a2']);
  expect(result.current.best).toBeNull();
});

it('has no best when the engine throws', () => {
  getRoutePerformances.mockImplementation(() => {
    throw new Error('engine down');
  });

  const { result } = renderHook(() => useRoutePerformances('a1', 'g1'));

  expect(result.current.performances).toEqual([]);
  expect(result.current.best).toBeNull();
});

it('leaves a route the engine has not named with an empty name, never its group id', () => {
  getRoutePerformances.mockReturnValue({
    performances: [performance('a1', 3600)],
    activityMetrics: [metrics('a1', 3600)],
    best: undefined,
    bestForward: undefined,
    bestReverse: undefined,
    forwardStats: undefined,
    reverseStats: undefined,
    currentRank: undefined,
  });

  const { result } = renderHook(() => useRoutePerformances('a1', 'g1'));

  expect(result.current.routeGroup?.id).toBe('g1');
  expect(result.current.routeGroup?.name).toBe('');
});

describe('a sport filter over a screen bundle', () => {
  const groups: FfiRouteGroup[] = [
    { groupId: 'g1', representativeId: 'a1', activityIds: ['a1', 'a2'] },
  ];
  const bundledMetrics = (activityId: string, movingTime: number): FfiActivityMetrics => ({
    ...metrics(activityId, movingTime),
    date: 1_700_000_000,
    sportType: 'Ride',
  });
  const bundledPerformance = (activityId: string, movingTime: number): FfiRoutePerformance => ({
    ...performance(activityId, movingTime),
    date: 1_700_000_000,
    duration: movingTime,
    isCurrent: activityId === 'a1',
    outsideDistanceBand: false,
    isRecord: false,
  });
  const filtered: FfiRoutePerformanceResult = {
    performances: [bundledPerformance('a1', 3600)],
    activityMetrics: [bundledMetrics('a1', 3600)],
    best: bundledPerformance('a1', 3600),
    currentRank: 1,
    attemptCount: 1,
    trendCurves: {},
    histograms: {},
  };
  const unfiltered: FfiRoutePerformanceResult = {
    ...filtered,
    performances: [bundledPerformance('a1', 3600), bundledPerformance('a2', 3000)],
    activityMetrics: [bundledMetrics('a1', 3600), bundledMetrics('a2', 3000)],
    attemptCount: 2,
  };

  it('reads the engine once across re-renders that rebuild the bundle object', () => {
    getRoutePerformances.mockReturnValue(filtered);

    // The screen builds this literal in its render body, so every render is a
    // new object with the same contents.
    const { result, rerender } = renderHook(
      ({ sport }: { sport?: string | undefined }) =>
        useRoutePerformances('a1', 'g1', sport, { groups, result: undefined }),
      { initialProps: { sport: 'Ride' } }
    );
    expect(result.current.performances).toHaveLength(1);

    rerender({ sport: 'Ride' });
    rerender({ sport: 'Ride' });

    expect(getRoutePerformances).toHaveBeenCalledTimes(1);
  });

  it('reads again when the filter changes, and not when it is cleared over a held result', () => {
    getRoutePerformances.mockReturnValue(filtered);

    const { result, rerender } = renderHook(
      ({ sport }: { sport?: string | undefined }) =>
        useRoutePerformances('a1', 'g1', sport, {
          groups,
          result: sport ? undefined : unfiltered,
        }),
      { initialProps: { sport: 'Ride' as string | undefined } }
    );
    expect(getRoutePerformances).toHaveBeenCalledTimes(1);

    rerender({ sport: 'Run' });
    expect(getRoutePerformances).toHaveBeenCalledTimes(2);
    expect(getRoutePerformances).toHaveBeenLastCalledWith('g1', 'a1', 'Run');

    rerender({ sport: undefined });
    expect(result.current.performances).toHaveLength(2);
    expect(getRoutePerformances).toHaveBeenCalledTimes(2);
  });
});

it('marks an attempt the engine flagged outside the distance band', () => {
  getRoutePerformances.mockReturnValue({
    performances: [
      performance('a1', 3600),
      { ...performance('a2', 3000), outsideDistanceBand: true },
    ],
    activityMetrics: [metrics('a1', 3600), metrics('a2', 3000)],
    best: performance('a1', 3600),
    bestForward: performance('a1', 3600),
    forwardStats: undefined,
    reverseStats: undefined,
    currentRank: 1,
  });

  const { result } = renderHook(() => useRoutePerformances('a1', 'g1'));

  const flagged = Object.fromEntries(
    result.current.performances.map((p) => [p.activityId, p.outsideDistanceBand])
  );
  expect(flagged).toEqual({ a1: false, a2: true });
});

describe('the trend curves the engine fitted', () => {
  const curve = [
    { time: 1_700_000_000, value: 6, upper: 6.5, lower: 5.5 },
    { time: 1_700_086_400, value: 6.4, upper: 6.9, lower: 5.9 },
  ];

  it('hands the engine result its curves unchanged', () => {
    const trendCurves = { forwardSpeed: curve, forwardTime: curve };
    getRoutePerformances.mockReturnValue({
      performances: [performance('a1', 3600)],
      activityMetrics: [metrics('a1', 3600)],
      trendCurves,
    });
    const { result } = renderHook(() => useRoutePerformances('a1', 'g1'));
    expect(result.current.trendCurves).toBe(trendCurves);
  });

  it('has no curves when the engine has no route to read', () => {
    getRoutePerformances.mockReturnValue(undefined);
    const { result } = renderHook(() => useRoutePerformances('a1', 'g1'));
    expect(result.current.trendCurves).toEqual({});
  });
});

describe('chart points come from the engine performances', () => {
  it('plots the engine speed and current flag with no metrics bundled', () => {
    getRoutePerformances.mockReturnValue({
      performances: [
        { ...performance('a1', 3600), speed: 7.5, isCurrent: true },
        { ...performance('a2', 3300), speed: 8.25, isCurrent: false },
      ],
      activityMetrics: [],
      best: performance('a2', 3300),
      currentRank: 1,
    });

    const { result } = renderHook(() => useRoutePerformances('a2', 'g1'));

    expect(result.current.performances.map((p) => [p.activityId, p.speed, p.isCurrent])).toEqual([
      ['a1', 7.5, false],
      ['a2', 8.25, true],
    ]);
    expect(result.current.best?.activityId).toBe('a2');
  });

  it('drops an attempt the engine gave no speed', () => {
    getRoutePerformances.mockReturnValue({
      performances: [{ ...performance('a1', 0), speed: 0 }, performance('a2', 3300)],
      activityMetrics: [],
      currentRank: 1,
    });

    const { result } = renderHook(() => useRoutePerformances('a1', 'g1'));

    expect(result.current.performances.map((p) => p.activityId)).toEqual(['a2']);
  });
});
