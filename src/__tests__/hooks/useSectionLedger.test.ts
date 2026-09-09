import { renderHook, act } from '@testing-library/react-native';
import { useSectionLedger } from '@/features/routes/hooks/useSectionLedger';
import { getEngine } from '@/shared/native/engine';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));

function engineWith(pinned: number | null) {
  return {
    getSectionHistory: jest.fn(() => [
      {
        id: 1n,
        at: '2026-08-01 00:00:00',
        kind: 'formed',
        details: undefined,
        geometryVersion: 1n,
      },
      { id: 2n, at: '2026-08-20 00:00:00', kind: 'recut', details: '{}', geometryVersion: 2n },
    ]),
    getSectionGeometryVersions: jest.fn(() => [
      { version: 1n, createdAt: '2026-08-01', milestone: true, pinned: pinned === 1 },
      { version: 2n, createdAt: '2026-08-20', milestone: false, pinned: pinned === 2 },
    ]),
    getPinnedSectionVersion: jest.fn(() => pinned),
    getSectionGeometryVersionPolyline: jest.fn(() => [{ lat: 46, lng: 7 }]),
    revertSectionToVersion: jest.fn(() => true),
    unpinSection: jest.fn(() => true),
  };
}

describe('useSectionLedger', () => {
  it('reads the ledger newest first with numbers, and re-reads after a revert', () => {
    const engine = engineWith(null);
    (getEngine as jest.Mock).mockReturnValue(engine);
    const { result } = renderHook(() => useSectionLedger('sec1'));

    expect(result.current.history.map((e) => e.kind)).toEqual(['recut', 'formed']);
    expect(result.current.history[0].id).toBe(2);
    expect(result.current.history[0].geometryVersion).toBe(2);
    expect(result.current.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(result.current.pinnedVersion).toBeNull();
    expect(result.current.versionPolyline(1)).toEqual([{ lat: 46, lng: 7 }]);

    engine.getPinnedSectionVersion.mockReturnValue(1);
    act(() => {
      expect(result.current.revert(1)).toBe(true);
    });
    expect(engine.revertSectionToVersion).toHaveBeenCalledWith('sec1', 1);
    expect(result.current.pinnedVersion).toBe(1);

    engine.getPinnedSectionVersion.mockReturnValue(null);
    act(() => {
      expect(result.current.unpin()).toBe(true);
    });
    expect(result.current.pinnedVersion).toBeNull();
  });

  it('is empty without an engine or a section', () => {
    (getEngine as jest.Mock).mockReturnValue(null);
    const { result } = renderHook(() => useSectionLedger('sec1'));
    expect(result.current.history).toEqual([]);
    expect(result.current.revert(1)).toBe(false);
  });

  it('re-reads when refreshKey changes and holds still when it does not', () => {
    const engine = engineWith(null);
    (getEngine as jest.Mock).mockReturnValue(engine);
    const { result, rerender } = renderHook(
      ({ key }: { key: number }) => useSectionLedger('sec1', key),
      { initialProps: { key: 0 } }
    );

    expect(engine.getSectionHistory).toHaveBeenCalledTimes(1);

    rerender({ key: 0 });
    expect(engine.getSectionHistory).toHaveBeenCalledTimes(1);

    engine.getPinnedSectionVersion.mockReturnValue(2);
    rerender({ key: 1 });
    expect(engine.getSectionHistory).toHaveBeenCalledTimes(2);
    expect(engine.getSectionGeometryVersions).toHaveBeenCalledTimes(2);
    expect(result.current.pinnedVersion).toBe(2);

    rerender({ key: 2 });
    expect(engine.getSectionHistory).toHaveBeenCalledTimes(3);
  });

  it('re-reads for a new section id and empties when the id goes away', () => {
    const engine = engineWith(1);
    (getEngine as jest.Mock).mockReturnValue(engine);
    const { result, rerender } = renderHook(
      ({ id }: { id: string | undefined }) => useSectionLedger(id, 0),
      { initialProps: { id: 'sec1' as string | undefined } }
    );

    expect(engine.getSectionHistory).toHaveBeenCalledWith('sec1');

    rerender({ id: 'sec2' });
    expect(engine.getSectionHistory).toHaveBeenCalledWith('sec2');
    expect(result.current.pinnedVersion).toBe(1);

    rerender({ id: undefined });
    expect(result.current.history).toEqual([]);
    expect(result.current.versions).toEqual([]);
    expect(result.current.pinnedVersion).toBeNull();
    expect(result.current.versionPolyline(1)).toEqual([]);
    expect(result.current.unpin()).toBe(false);
  });
});
