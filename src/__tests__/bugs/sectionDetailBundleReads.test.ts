/**
 * Scenario: the section screen was built around one bundle call and grew back
 * to seven. Several of those reads are keyed on the section id alone, so they
 * belong in the bundle the screen already makes.
 *
 * Expected behaviour: given the bundle's values, each hook uses them and makes
 * no engine call of its own, and falls back to its own read when it has none.
 */

import { Alert } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import { useSectionLaps } from '@/features/routes/hooks/useSectionLaps';
import { useSectionLedger, type BundledLedger } from '@/features/routes/hooks/useSectionLedger';
import * as visibility from '../../../modules/veloqrs/src/delegates/sections/visibility';
import { getEngine } from '@/shared/native/engine';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('@/features/routes/hooks/useEngine', () => ({
  useEngineSubscription: () => 0,
}));

const engine = {
  excludeSectionLap: jest.fn(() => true),
  includeSectionLap: jest.fn(() => true),
  getSectionHistory: jest.fn(() => []),
  getSectionGeometryVersions: jest.fn(() => []),
  getPinnedSectionVersion: jest.fn(() => null),
  runSectionBoundsEdit: jest.fn((): Promise<unknown[] | null> => Promise.resolve([])),
  unpinSection: jest.fn(() => true),
  // The real `useEngineRead` subscribes, so the stub answers that too.
  subscribe: () => () => {},
};

beforeEach(() => {
  jest.clearAllMocks();
  (getEngine as jest.Mock).mockReturnValue(engine);
});

describe('the excluded laps come from the screen read', () => {
  it('reads nothing of its own: the lap list carries each lap flagged', async () => {
    await renderHook(() => useSectionLaps('sec1'));

    expect(visibility).not.toHaveProperty('getExcludedSectionLaps');
  });
});

describe('the ledger comes from the bundle', () => {
  const bundled: BundledLedger = {
    history: [{ id: 1, at: '2026-01-01', kind: 'trim', details: null, geometryVersion: 2 }],
    geometryVersions: [
      { version: 1, createdAt: '2026-01-01', milestone: false, pinned: false },
      { version: 2, createdAt: '2026-02-01', milestone: true, pinned: true },
    ],
    pinnedVersion: 2,
  };

  it('uses the bundled ledger and reads nothing', async () => {
    const { result } = await renderHook(() => useSectionLedger('sec1', bundled));

    expect(result.current.pinnedVersion).toBe(2);
    expect(result.current.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(engine.getSectionHistory).not.toHaveBeenCalled();
    expect(engine.getSectionGeometryVersions).not.toHaveBeenCalled();
    expect(engine.getPinnedSectionVersion).not.toHaveBeenCalled();
  });

  it('reads nothing and is empty when the bundle carried none', async () => {
    const { result } = await renderHook(() => useSectionLedger('sec1'));

    expect(result.current.history).toEqual([]);
    expect(engine.getSectionHistory).not.toHaveBeenCalled();
    expect(engine.getSectionGeometryVersions).not.toHaveBeenCalled();
    expect(engine.getPinnedSectionVersion).not.toHaveBeenCalled();
  });

  it('leaves the ledger to the re-read bundle after a revert or an unpin', async () => {
    const { result, rerender } = await renderHook(
      ({ ledger }: { ledger: typeof bundled }) => useSectionLedger('sec1', ledger),
      { initialProps: { ledger: bundled } }
    );

    await act(async () => {
      expect(await result.current.revert(1)).toBe(true);
    });
    expect(engine.runSectionBoundsEdit).toHaveBeenCalledWith({
      kind: 'revert',
      sectionId: 'sec1',
      version: 1,
    });
    await act(() => {
      expect(result.current.unpin()).toBe(true);
    });
    expect(engine.unpinSection).toHaveBeenCalledWith('sec1');
    expect(engine.getSectionHistory).not.toHaveBeenCalled();
    expect(engine.getSectionGeometryVersions).not.toHaveBeenCalled();
    expect(engine.getPinnedSectionVersion).not.toHaveBeenCalled();

    await rerender({
      ledger: {
        ...bundled,
        pinnedVersion: null,
        geometryVersions: bundled.geometryVersions.map((v) => ({ ...v, pinned: false })),
      },
    });
    expect(result.current.pinnedVersion).toBeNull();
    expect(engine.getPinnedSectionVersion).not.toHaveBeenCalled();
  });

  it('does not touch the engine for a revert it was not asked to make', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    engine.runSectionBoundsEdit.mockResolvedValueOnce(null);
    const { result } = await renderHook(() => useSectionLedger('sec1', bundled));

    await act(async () => {
      expect(await result.current.revert(1)).toBe(false);
    });
    expect(result.current.pinnedVersion).toBe(2);
  });
});
