/**
 * Scenario: the engine throws while the route's excluded laps are read.
 *
 * Expected behaviour: the hook hands the thrown value back as `error` beside
 * its empty value, so a screen can say the read failed instead of drawing a
 * route with no excluded laps.
 */

import { act, renderHook } from '@testing-library/react-native';

import { getEngine } from '@/shared/native/engine';
import { useExcludedActivities } from '@/features/routes/hooks/useExcludedActivities';
import { useSectionChartData } from '@/features/routes/hooks/useSectionChartData';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides({}));

const lockFailed = { tag: 'Database', inner: { msg: 'poisoned' } };

const engine = {
  subscribe: () => () => undefined,
  getExcludedRouteActivityIds: jest.fn(() => ['a1']),
  getExcludedRoutePerformances: jest.fn(() => {
    throw lockFailed;
  }),
  getSectionChartData: jest.fn(() => {
    throw lockFailed;
  }),
};

beforeEach(() => {
  jest.clearAllMocks();
  (getEngine as jest.Mock).mockReturnValue(engine);
});

describe('useExcludedActivities', () => {
  it('hands a thrown performances read back as an error', () => {
    const { result } = renderHook(() => useExcludedActivities('route-1', undefined));
    expect(result.current.excludedReadError).toBeUndefined();

    act(() => result.current.handleToggleShowExcluded());

    expect(result.current.excludedReadError).toBe(lockFailed);
    expect(result.current.excludedChartData).toEqual([]);
  });

  it('carries no error while the excluded laps are hidden', () => {
    const { result } = renderHook(() => useExcludedActivities('route-1', undefined));

    expect(result.current.excludedReadError).toBeUndefined();
    expect(engine.getExcludedRoutePerformances).not.toHaveBeenCalled();
  });
});

describe('useSectionChartData', () => {
  const params = {
    section: { id: 'sec-1', activityPortions: [] } as never,
    performanceRecords: undefined,
    sectionActivitiesUnsorted: [],
    sectionWithTraces: null,
    sectionTimeRange: '3m' as never,
    preComputedChart: null,
  };

  it('never reads the engine for a chart; the screen read supplies it', () => {
    const omitted = { ...params } as Partial<typeof params>;
    delete omitted.preComputedChart;
    const { result } = renderHook(() => useSectionChartData(omitted as typeof params));

    expect(result.current.chartData).toEqual([]);
    expect(engine.getSectionChartData).not.toHaveBeenCalled();
  });
});
