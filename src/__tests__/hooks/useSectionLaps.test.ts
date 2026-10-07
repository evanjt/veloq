import { renderHook, act } from '@testing-library/react-native';
import { useSectionLaps, hasPartialExclusion } from '@/features/routes/hooks/useSectionLaps';
import { getEngine } from '@/shared/native/engine';
import type { SectionPerformanceRecord } from '@/features/routes/hooks/useSectionPerformances';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));

/** Laps as the screen read returns them, the excluded ones flagged. */
function record(
  activityId: string,
  starts: number[],
  excluded: number[] = []
): SectionPerformanceRecord {
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
      avgHr: null,
      avgPower: null,
      excluded: excluded.includes(s),
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
  it('moves one lap both ways by its junction key', () => {
    const engine = {
      excludeSectionLap: jest.fn(() => true),
      includeSectionLap: jest.fn(() => true),
    };
    (getEngine as jest.Mock).mockReturnValue(engine);
    const { result } = renderHook(() => useSectionLaps('sec1'));

    act(() => result.current.excludeLap('a', 10));
    expect(engine.excludeSectionLap).toHaveBeenCalledWith('sec1', 'a', 10);

    act(() => result.current.includeLap('a', 40));
    expect(engine.includeSectionLap).toHaveBeenCalledWith('sec1', 'a', 40);
  });

  it('does nothing without an engine', () => {
    (getEngine as jest.Mock).mockReturnValue(null);
    const { result } = renderHook(() => useSectionLaps('sec1'));
    expect(() => result.current.excludeLap('a', 10)).not.toThrow();
  });
});

describe('hasPartialExclusion', () => {
  it('is true only when some, not all, laps of a lapped activity are out', () => {
    expect(hasPartialExclusion([record('a', [10, 40, 70]), record('b', [5])])).toBe(false);
    expect(hasPartialExclusion([record('a', [10, 40, 70], [40]), record('b', [5])])).toBe(true);
    expect(hasPartialExclusion([record('a', [10, 40, 70], [10, 40, 70])])).toBe(false);
    expect(hasPartialExclusion([record('b', [5], [5])])).toBe(false);
  });

  it('sees a two-lap activity with one lap out', () => {
    expect(hasPartialExclusion([record('a', [10, 40], [40])])).toBe(true);
  });

  it('is false with no records', () => {
    expect(hasPartialExclusion([])).toBe(false);
  });
});
