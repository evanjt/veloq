import { renderHook, act } from '@testing-library/react-native';
import { useSectionLedger, type BundledLedger } from '@/features/routes/hooks/useSectionLedger';
import { getEngine } from '@/shared/native/engine';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));

function engineWith() {
  return {
    getSectionGeometryVersionPolyline: jest.fn(() => [{ lat: 46, lng: 7 }]),
    revertSectionToVersion: jest.fn(() => [] as unknown[]),
    unpinSection: jest.fn(() => true),
  };
}

function bundleWith(pinned: number | null): BundledLedger {
  return {
    history: [
      {
        id: 1n,
        at: '2026-08-01 00:00:00',
        kind: 'formed',
        details: null,
        geometryVersion: 1n,
      },
      {
        id: 2n,
        at: '2026-08-20 00:00:00',
        kind: 'recut',
        details: { around: [], forkAround: [], prs: [], siblings: [], splitInto: [], reasons: [] },
        geometryVersion: 2n,
      },
    ],
    geometryVersions: [
      { version: 1n, createdAt: '2026-08-01', milestone: true, pinned: pinned === 1 },
      { version: 2n, createdAt: '2026-08-20', milestone: false, pinned: pinned === 2 },
    ],
    pinnedVersion: pinned,
  };
}

describe('useSectionLedger', () => {
  it('shows the bundle newest first with numbers, and follows the next bundle after a write', () => {
    const engine = engineWith();
    (getEngine as jest.Mock).mockReturnValue(engine);
    const { result, rerender } = renderHook(
      ({ bundle }: { bundle: BundledLedger }) => useSectionLedger('sec1', bundle),
      { initialProps: { bundle: bundleWith(null) } }
    );

    expect(result.current.history.map((e) => e.kind)).toEqual(['recut', 'formed']);
    expect(result.current.history[0].id).toBe(2);
    expect(result.current.history[0].geometryVersion).toBe(2);
    expect(result.current.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(result.current.pinnedVersion).toBeNull();
    expect(result.current.versionPolyline(1)).toEqual([{ lat: 46, lng: 7 }]);

    act(() => {
      expect(result.current.revert(1)).toBe(true);
    });
    expect(engine.revertSectionToVersion).toHaveBeenCalledWith('sec1', 1);
    expect(result.current.pinnedVersion).toBeNull();
    rerender({ bundle: bundleWith(1) });
    expect(result.current.pinnedVersion).toBe(1);

    act(() => {
      expect(result.current.unpin()).toBe(true);
    });
    expect(engine.unpinSection).toHaveBeenCalledWith('sec1');
    rerender({ bundle: bundleWith(null) });
    expect(result.current.pinnedVersion).toBeNull();
  });

  it('is empty without a bundle, and writes nothing without an engine', () => {
    (getEngine as jest.Mock).mockReturnValue(null);
    const { result } = renderHook(() => useSectionLedger('sec1'));
    expect(result.current.history).toEqual([]);
    expect(result.current.revert(1)).toBe(false);
    expect(result.current.unpin()).toBe(false);
  });

  it('draws no line for a stored version it cannot read', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const engine = engineWith();
    engine.getSectionGeometryVersionPolyline.mockImplementation(() => {
      throw Object.assign(new Error('Database'), { tag: 'Database' });
    });
    (getEngine as jest.Mock).mockReturnValue(engine);

    const { result } = renderHook(() => useSectionLedger('sec1', bundleWith(null)));

    expect(result.current.history).toHaveLength(2);
    expect(result.current.versionPolyline(1)).toEqual([]);
  });

  it('keeps the same rows while the bundle holds still, and empties when the id goes away', () => {
    const engine = engineWith();
    (getEngine as jest.Mock).mockReturnValue(engine);
    const bundle = bundleWith(1);
    const { result, rerender } = renderHook(
      ({ id }: { id: string | undefined }) => useSectionLedger(id, id ? bundle : undefined),
      { initialProps: { id: 'sec1' as string | undefined } }
    );
    const rows = result.current.history;

    rerender({ id: 'sec1' });
    expect(result.current.history).toBe(rows);

    rerender({ id: undefined });
    expect(result.current.history).toEqual([]);
    expect(result.current.versions).toEqual([]);
    expect(result.current.pinnedVersion).toBeNull();
    expect(result.current.versionPolyline(1)).toEqual([]);
    expect(result.current.unpin()).toBe(false);
  });

  it("hands the engine's typed details to the panel and reads an absent record as none", () => {
    const engine = engineWith();
    const linked = { id: 'parent', name: 'Col de la Croix', available: true };
    const bundle = bundleWith(null);
    bundle.history = [
      {
        id: 3n,
        at: '2026-08-21 00:00:00',
        kind: 'formed',
        details: {
          around: ['a1'],
          forkAround: [],
          prs: [],
          siblings: [],
          splitFrom: linked,
          splitInto: [],
          reasons: [],
        },
        geometryVersion: 1n,
      },
      {
        id: 4n,
        at: '2026-08-22 00:00:00',
        kind: 'recut',
        details: null,
        geometryVersion: null,
      },
    ];
    bundle.geometryVersions = [];
    (getEngine as jest.Mock).mockReturnValue(engine);

    const { result } = renderHook(() => useSectionLedger('child', bundle));

    expect(result.current.history[1].details?.splitFrom).toEqual(linked);
    expect(result.current.history[1].details?.around).toEqual(['a1']);
    expect(result.current.history[0].details).toBeUndefined();
  });
});
