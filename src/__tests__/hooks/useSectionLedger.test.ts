import { renderHook, act } from '@testing-library/react-native';
import { useSectionLedger } from '@/features/routes/hooks/useSectionLedger';
import { getRouteEngine } from '@/shared/native/routeEngine';

jest.mock('@/shared/native/routeEngine', () => ({ getRouteEngine: jest.fn() }));

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
    (getRouteEngine as jest.Mock).mockReturnValue(engine);
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
    (getRouteEngine as jest.Mock).mockReturnValue(null);
    const { result } = renderHook(() => useSectionLedger('sec1'));
    expect(result.current.history).toEqual([]);
    expect(result.current.revert(1)).toBe(false);
  });
});
