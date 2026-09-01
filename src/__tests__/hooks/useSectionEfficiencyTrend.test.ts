/**
 * Scenario: the aerobic efficiency the engine already computes per section.
 * Expected behaviour: the section screen asks the engine for it, and takes
 * nothing it cannot plot.
 */

import { renderHook } from '@testing-library/react-native';
import { useSectionEfficiencyTrend } from '@/features/routes/hooks/useSectionEfficiencyTrend';
import { getEngine } from '@/shared/native/engine';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('@/features/routes/hooks/useEngine', () => ({
  useEngineSubscription: () => 0,
}));

function point(date: number, ratio: number) {
  return {
    date: BigInt(date),
    paceSecsPerKm: 240,
    avgHr: 150,
    hrPaceRatio: ratio,
  };
}

function trend(points: ReturnType<typeof point>[]) {
  return {
    sectionId: 'sec-1',
    sectionName: 'Church Hill',
    points,
    trendSlope: -0.0004,
    isImproving: true,
    hrChangeBpm: -6.2,
    effortCount: points.length,
  };
}

const getSectionEfficiencyTrend = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (getEngine as jest.Mock).mockReturnValue({ getSectionEfficiencyTrend });
});

it('returns the engine trend for a section', () => {
  const engineTrend = trend([point(1, 0.62), point(2, 0.6), point(3, 0.58)]);
  getSectionEfficiencyTrend.mockReturnValue(engineTrend);

  const { result } = renderHook(() => useSectionEfficiencyTrend('sec-1'));

  expect(getSectionEfficiencyTrend).toHaveBeenCalledWith('sec-1');
  expect(result.current).toBe(engineTrend);
});

it('asks the engine for nothing when there is no section', () => {
  const { result } = renderHook(() => useSectionEfficiencyTrend(null));

  expect(getSectionEfficiencyTrend).not.toHaveBeenCalled();
  expect(result.current).toBeNull();
});

it('drops a trend with a single point, which cannot be plotted', () => {
  getSectionEfficiencyTrend.mockReturnValue(trend([point(1, 0.62)]));

  const { result } = renderHook(() => useSectionEfficiencyTrend('sec-1'));

  expect(result.current).toBeNull();
});

it('returns null when the engine has no efficiency data for the section', () => {
  getSectionEfficiencyTrend.mockReturnValue(null);

  const { result } = renderHook(() => useSectionEfficiencyTrend('sec-1'));

  expect(result.current).toBeNull();
});

it('returns null when the engine call throws', () => {
  getSectionEfficiencyTrend.mockImplementation(() => {
    throw new Error('engine down');
  });

  const { result } = renderHook(() => useSectionEfficiencyTrend('sec-1'));

  expect(result.current).toBeNull();
});

it('returns null when there is no engine', () => {
  (getEngine as jest.Mock).mockReturnValue(null);

  const { result } = renderHook(() => useSectionEfficiencyTrend('sec-1'));

  expect(result.current).toBeNull();
});
