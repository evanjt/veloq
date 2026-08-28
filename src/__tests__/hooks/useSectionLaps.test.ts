import { renderHook, act } from '@testing-library/react-native';
import {
  useSectionLaps,
  hasPartialExclusion,
  lapKey,
} from '@/features/routes/hooks/useSectionLaps';
import { getRouteEngine } from '@/shared/native/routeEngine';
import type { SectionPerformanceRecord } from '@/features/routes/hooks/useSectionPerformances';

jest.mock('@/shared/native/routeEngine', () => ({ getRouteEngine: jest.fn() }));

function record(activityId: string, starts: number[]): SectionPerformanceRecord {
  return {
    activityId,
    activityName: activityId,
    activityDate: new Date('2026-08-01'),
    laps: starts.map((s, i) => ({
      id: `${activityId}-${s}`,
      activityId,
      time: 100 + i,
      pace: 3,
      distance: 300,
      direction: 'same' as const,
      startIndex: s,
      endIndex: s + 30,
    })),
    lapCount: starts.length,
    bestTime: 100,
    bestPace: 3,
    avgTime: 100,
    avgPace: 3,
    direction: 'same',
  } as SectionPerformanceRecord;
}

describe('useSectionLaps', () => {
  it('reads the excluded laps by junction key and moves one both ways', () => {
    const excluded = [{ activityId: 'a', startIndex: 40 }];
    const engine = {
      getExcludedSectionLaps: jest.fn(() => excluded),
      excludeSectionLap: jest.fn(() => true),
      includeSectionLap: jest.fn(() => true),
    };
    (getRouteEngine as jest.Mock).mockReturnValue(engine);
    const { result } = renderHook(() => useSectionLaps('sec1'));
    expect(result.current.excludedLaps).toEqual(new Set([lapKey('a', 40)]));

    excluded.push({ activityId: 'a', startIndex: 10 });
    act(() => result.current.excludeLap('a', 10));
    expect(engine.excludeSectionLap).toHaveBeenCalledWith('sec1', 'a', 10);
    expect(result.current.excludedLaps.has(lapKey('a', 10))).toBe(true);

    excluded.splice(0, 2);
    act(() => result.current.includeLap('a', 40));
    expect(engine.includeSectionLap).toHaveBeenCalledWith('sec1', 'a', 40);
    expect(result.current.excludedLaps.size).toBe(0);
  });

  it('is empty without an engine', () => {
    (getRouteEngine as jest.Mock).mockReturnValue(null);
    const { result } = renderHook(() => useSectionLaps('sec1'));
    expect(result.current.excludedLaps.size).toBe(0);
  });
});

describe('hasPartialExclusion', () => {
  const records = [record('a', [10, 40, 70]), record('b', [5])];

  it('is true only when some, not all, laps of a lapped activity are out', () => {
    expect(hasPartialExclusion(records, new Set())).toBe(false);
    expect(hasPartialExclusion(records, new Set([lapKey('a', 40)]))).toBe(true);
    expect(
      hasPartialExclusion(records, new Set([lapKey('a', 10), lapKey('a', 40), lapKey('a', 70)]))
    ).toBe(false);
    expect(hasPartialExclusion(records, new Set([lapKey('b', 5)]))).toBe(false);
  });
});
