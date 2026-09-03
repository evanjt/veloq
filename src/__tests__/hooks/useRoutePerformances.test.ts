/**
 * Scenario: the route screen asks the engine which attempt on this route is the
 * fastest.
 * Expected behaviour: the engine's ruling is the answer. The hook does not
 * re-derive it from the metrics it happens to hold.
 */

import { renderHook } from '@testing-library/react-native';
import { useRoutePerformances } from '@/features/routes/hooks/useRoutePerformances';
import { getEngine } from '@/shared/native/engine';

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
  // A zero moving time cannot be plotted, so the point never enters the chart.
  getRoutePerformances.mockReturnValue({
    performances: [performance('a1', 3600), performance('a2', 3300)],
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
