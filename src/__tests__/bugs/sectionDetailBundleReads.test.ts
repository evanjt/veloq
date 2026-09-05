/**
 * Scenario: the section screen was built around one bundle call and grew back
 * to seven. Five of those reads are keyed on the section id alone, so they
 * belong in the bundle the screen already makes.
 *
 * Expected behaviour: given the bundle's values, each hook uses them and makes
 * no engine call of its own, and falls back to its own read when it has none.
 */

import { renderHook } from '@testing-library/react-native';
import { useSectionLaps, lapKey } from '@/features/routes/hooks/useSectionLaps';
import { useSectionLedger } from '@/features/routes/hooks/useSectionLedger';
import { useSectionEfficiencyTrend } from '@/features/routes/hooks/useSectionEfficiencyTrend';
import { getEngine } from '@/shared/native/engine';
import type { EfficiencyTrend } from 'veloqrs';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('@/features/routes/hooks/useEngine', () => ({
  useEngineSubscription: () => 0,
}));

const engine = {
  getExcludedSectionLaps: jest.fn(() => []),
  excludeSectionLap: jest.fn(() => true),
  includeSectionLap: jest.fn(() => true),
  getSectionHistory: jest.fn(() => []),
  getSectionGeometryVersions: jest.fn(() => []),
  getPinnedSectionVersion: jest.fn(() => null),
  getSectionEfficiencyTrend: jest.fn(() => null),
};

beforeEach(() => {
  jest.clearAllMocks();
  (getEngine as jest.Mock).mockReturnValue(engine);
});

function point(date: number, ratio: number) {
  return { date: BigInt(date), paceSecsPerKm: 300, avgHr: 150, hrPaceRatio: ratio };
}

const trend: EfficiencyTrend = {
  sectionId: 'sec1',
  sectionName: 'Col des Planches',
  points: [point(1, 0.5), point(2, 0.4)],
  trendSlope: -0.1,
  isImproving: true,
  hrChangeBpm: -3,
  effortCount: 4,
};

describe('the excluded laps come from the bundle', () => {
  it('uses the bundled laps and reads nothing', () => {
    const { result } = renderHook(() =>
      useSectionLaps('sec1', 0, [{ activityId: 'a', startIndex: 40 }])
    );

    expect(result.current.excludedLaps).toEqual(new Set([lapKey('a', 40)]));
    expect(engine.getExcludedSectionLaps).not.toHaveBeenCalled();
  });

  it('reads for itself when the bundle carried none', () => {
    renderHook(() => useSectionLaps('sec1'));

    expect(engine.getExcludedSectionLaps).toHaveBeenCalledWith('sec1');
  });

  it('takes an empty bundled list as an answer, not as absent', () => {
    const { result } = renderHook(() => useSectionLaps('sec1', 0, []));

    expect(result.current.excludedLaps.size).toBe(0);
    expect(engine.getExcludedSectionLaps).not.toHaveBeenCalled();
  });
});

describe('the ledger comes from the bundle', () => {
  const bundled = {
    history: [{ id: 1n, at: '2026-01-01', kind: 'trim', details: null, geometryVersion: 2n }],
    geometryVersions: [
      { version: 1n, createdAt: '2026-01-01', milestone: false, pinned: false },
      { version: 2n, createdAt: '2026-02-01', milestone: true, pinned: true },
    ],
    pinnedVersion: 2n,
  };

  it('uses the bundled ledger and reads nothing', () => {
    const { result } = renderHook(() => useSectionLedger('sec1', 0, bundled));

    expect(result.current.pinnedVersion).toBe(2);
    expect(result.current.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(engine.getSectionHistory).not.toHaveBeenCalled();
    expect(engine.getSectionGeometryVersions).not.toHaveBeenCalled();
    expect(engine.getPinnedSectionVersion).not.toHaveBeenCalled();
  });

  it('reads for itself when the bundle carried none', () => {
    renderHook(() => useSectionLedger('sec1'));

    expect(engine.getSectionHistory).toHaveBeenCalledWith('sec1');
    expect(engine.getSectionGeometryVersions).toHaveBeenCalledWith('sec1');
    expect(engine.getPinnedSectionVersion).toHaveBeenCalledWith('sec1');
  });
});

describe('the efficiency trend comes from the bundle', () => {
  it('uses the bundled trend and reads nothing', () => {
    const { result } = renderHook(() => useSectionEfficiencyTrend('sec1', trend));

    expect(result.current).toBe(trend);
    expect(engine.getSectionEfficiencyTrend).not.toHaveBeenCalled();
  });

  it('drops a bundled trend that cannot be plotted', () => {
    const { result } = renderHook(() =>
      useSectionEfficiencyTrend('sec1', { ...trend, points: [point(1, 0.5)] })
    );

    expect(result.current).toBeNull();
    expect(engine.getSectionEfficiencyTrend).not.toHaveBeenCalled();
  });

  it('takes a bundled null as an answer, not as absent', () => {
    const { result } = renderHook(() => useSectionEfficiencyTrend('sec1', null));

    expect(result.current).toBeNull();
    expect(engine.getSectionEfficiencyTrend).not.toHaveBeenCalled();
  });

  it('reads for itself when the bundle carried none', () => {
    renderHook(() => useSectionEfficiencyTrend('sec1'));

    expect(engine.getSectionEfficiencyTrend).toHaveBeenCalledWith('sec1');
  });
});
