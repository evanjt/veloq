/**
 * Scenario: the aerobic efficiency the engine already computes per section.
 * Expected behaviour: the section screen asks the engine for it, and takes
 * nothing it cannot plot.
 */

import { renderHook } from '@testing-library/react-native';
import { useSectionEfficiencyTrend } from '@/features/routes/hooks/useSectionEfficiencyTrend';
import { getEngine } from '@/shared/native/engine';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));

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
    sportType: 'Ride',
    points,
    trendSlope: -0.0004,
    direction: 0,
    hrChangeBpm: -6.2,
    effortCount: points.length,
  };
}

const getSectionEfficiencyTrend = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  // The real `useEngineRead` subscribes, so the stub answers that too and the
  // hook is exercised through the reader rather than around it.
  (getEngine as jest.Mock).mockReturnValue({
    getSectionEfficiencyTrend,
    subscribe: () => () => {},
  });
});

it('returns the engine trend for a section', () => {
  const engineTrend = trend([point(1, 0.62), point(2, 0.6), point(3, 0.58)]);
  getSectionEfficiencyTrend.mockReturnValue(engineTrend);

  const { result } = renderHook(() => useSectionEfficiencyTrend('sec-1', 'Ride'));

  expect(getSectionEfficiencyTrend).toHaveBeenCalledWith('sec-1', 'Ride');
  expect(result.current.trend).toBe(engineTrend);
});

it('asks the engine for nothing when there is no section', () => {
  const { result } = renderHook(() => useSectionEfficiencyTrend(null, 'Ride'));

  expect(getSectionEfficiencyTrend).not.toHaveBeenCalled();
  expect(result.current.trend).toBeNull();
});

it('drops a trend with a single point, which cannot be plotted', () => {
  getSectionEfficiencyTrend.mockReturnValue(trend([point(1, 0.62)]));

  const { result } = renderHook(() => useSectionEfficiencyTrend('sec-1', 'Ride'));

  expect(result.current.trend).toBeNull();
});

it('returns null when the engine has no efficiency data for the section', () => {
  getSectionEfficiencyTrend.mockReturnValue(null);

  const { result } = renderHook(() => useSectionEfficiencyTrend('sec-1', 'Ride'));

  expect(result.current.trend).toBeNull();
});

it('hands back the error, with no trend, when the engine call throws', () => {
  const lockFailed = { tag: 'Database', inner: { msg: 'poisoned' } };
  getSectionEfficiencyTrend.mockImplementation(() => {
    throw lockFailed;
  });

  const { result } = renderHook(() => useSectionEfficiencyTrend('sec-1', 'Ride'));

  expect(result.current.trend).toBeNull();
  expect(result.current.error).toBe(lockFailed);
});

it('carries no error when the engine has no efficiency data', () => {
  getSectionEfficiencyTrend.mockReturnValue(null);

  const { result } = renderHook(() => useSectionEfficiencyTrend('sec-1', 'Ride'));

  expect(result.current.error).toBeUndefined();
});

it('returns null when there is no engine', () => {
  (getEngine as jest.Mock).mockReturnValue(null);

  const { result } = renderHook(() => useSectionEfficiencyTrend('sec-1', 'Ride'));

  expect(result.current.trend).toBeNull();
});

it('reads the engine for the sport on screen when the bundled trend is another sport', () => {
  const runTrend = { ...trend([point(1, 0.62), point(2, 0.6)]), sportType: 'Run' };
  const rideTrend = { ...runTrend, sportType: 'Ride' };
  getSectionEfficiencyTrend.mockReturnValue(rideTrend);

  const { result } = renderHook(() =>
    useSectionEfficiencyTrend('sec-1', 'Ride', runTrend as never)
  );

  expect(getSectionEfficiencyTrend).toHaveBeenCalledWith('sec-1', 'Ride');
  expect(result.current.trend).toBe(rideTrend);
});

it('uses the bundled trend without a read when it is for the sport on screen', () => {
  const bundled = { ...trend([point(1, 0.62), point(2, 0.6)]), sportType: 'Ride' };

  const { result } = renderHook(() => useSectionEfficiencyTrend('sec-1', 'Ride', bundled as never));

  expect(getSectionEfficiencyTrend).not.toHaveBeenCalled();
  expect(result.current.trend).toBe(bundled);
});
