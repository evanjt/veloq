import { Alert } from 'react-native';
import { renderHook, act } from '@testing-library/react-native';
import { useSectionLedger, type BundledLedger } from '@/features/routes/hooks/useSectionLedger';
import { getEngine } from '@/shared/native/engine';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));

function engineWith() {
  return {
    getSectionGeometryVersionPolyline: jest.fn(() => [{ lat: 46, lng: 7 }]),
    runSectionBoundsEdit: jest.fn((): Promise<unknown[] | null> => Promise.resolve([])),
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
        details: {
          around: [],
          forkAround: [],
          prs: [],
          siblings: [],
          splitInto: [],
          boundaries: [],
        },
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
  it('shows the bundle newest first with numbers, and follows the next bundle after a write', async () => {
    const engine = engineWith();
    (getEngine as jest.Mock).mockReturnValue(engine);
    const { result, rerender } = await renderHook(
      ({ bundle }: { bundle: BundledLedger }) => useSectionLedger('sec1', bundle),
      { initialProps: { bundle: bundleWith(null) } }
    );

    expect(result.current.history.map((e) => e.kind)).toEqual(['recut', 'formed']);
    expect(result.current.history[0].id).toBe(2);
    expect(result.current.history[0].geometryVersion).toBe(2);
    expect(result.current.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(result.current.pinnedVersion).toBeNull();
    expect(result.current.versionPolyline(1)).toEqual([{ lat: 46, lng: 7 }]);

    await act(async () => {
      expect(await result.current.revert(1)).toBe(true);
    });
    expect(engine.runSectionBoundsEdit).toHaveBeenCalledWith({
      kind: 'revert',
      sectionId: 'sec1',
      version: 1,
    });
    expect(result.current.pinnedVersion).toBeNull();
    await rerender({ bundle: bundleWith(1) });
    expect(result.current.pinnedVersion).toBe(1);

    await act(() => {
      expect(result.current.unpin()).toBe(true);
    });
    expect(engine.unpinSection).toHaveBeenCalledWith('sec1');
    await rerender({ bundle: bundleWith(null) });
    expect(result.current.pinnedVersion).toBeNull();
  });

  it('is empty without a bundle, and writes nothing without an engine', async () => {
    (getEngine as jest.Mock).mockReturnValue(null);
    const { result } = await renderHook(() => useSectionLedger('sec1'));
    expect(result.current.history).toEqual([]);
    expect(await result.current.revert(1)).toBe(false);
    expect(result.current.unpin()).toBe(false);
  });

  it('draws no line for a stored version it cannot read', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const engine = engineWith();
    engine.getSectionGeometryVersionPolyline.mockImplementation(() => {
      throw Object.assign(new Error('Database'), { tag: 'Database' });
    });
    (getEngine as jest.Mock).mockReturnValue(engine);

    const { result } = await renderHook(() => useSectionLedger('sec1', bundleWith(null)));

    expect(result.current.history).toHaveLength(2);
    expect(result.current.versionPolyline(1)).toEqual([]);
  });

  it('keeps the same rows while the bundle holds still, and empties when the id goes away', async () => {
    const engine = engineWith();
    (getEngine as jest.Mock).mockReturnValue(engine);
    const bundle = bundleWith(1);
    const { result, rerender } = await renderHook(
      ({ id }: { id: string | undefined }) => useSectionLedger(id, id ? bundle : undefined),
      { initialProps: { id: 'sec1' as string | undefined } }
    );
    const rows = result.current.history;

    await rerender({ id: 'sec1' });
    expect(result.current.history).toBe(rows);

    await rerender({ id: undefined });
    expect(result.current.history).toEqual([]);
    expect(result.current.versions).toEqual([]);
    expect(result.current.pinnedVersion).toBeNull();
    expect(result.current.versionPolyline(1)).toEqual([]);
    expect(result.current.unpin()).toBe(false);
  });

  it("hands the engine's typed details to the panel and reads an absent record as none", async () => {
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
          boundaries: [],
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

    const { result } = await renderHook(() => useSectionLedger('child', bundle));

    expect(result.current.history[1].details?.splitFrom).toEqual(linked);
    expect(result.current.history[1].details?.around).toEqual(['a1']);
    expect(result.current.history[0].details).toBeUndefined();
  });
});

/**
 * Scenario: the athlete reverts a section to a stored version, which re-matches
 * every ride against that line.
 * Expected behaviour: the revert runs off the JS thread, so the handler returns
 * while it runs, a second revert is refused until it ends, and a failure is
 * shown.
 */
describe('reverting to a stored version', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('returns while the revert runs and refuses a second revert', async () => {
    const engine = engineWith();
    engine.runSectionBoundsEdit.mockImplementation(() => new Promise(() => {}));
    (getEngine as jest.Mock).mockReturnValue(engine);
    const { result } = await renderHook(() => useSectionLedger('sec1', bundleWith(null)));

    let first: Promise<boolean> | undefined;
    await act(() => {
      first = result.current.revert(1);
    });
    expect(first).toBeInstanceOf(Promise);
    expect(result.current.isReverting).toBe(true);

    let second: boolean | undefined;
    await act(async () => {
      second = await result.current.revert(2);
    });
    expect(second).toBe(false);
    expect(engine.runSectionBoundsEdit).toHaveBeenCalledTimes(1);
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('shows the failure and frees the action when the revert fails', async () => {
    const engine = engineWith();
    engine.runSectionBoundsEdit.mockResolvedValueOnce(null).mockResolvedValueOnce([]);
    (getEngine as jest.Mock).mockReturnValue(engine);
    const { result } = await renderHook(() => useSectionLedger('sec1', bundleWith(null)));

    await act(async () => {
      expect(await result.current.revert(1)).toBe(false);
    });
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect((Alert.alert as jest.Mock).mock.calls[0][1]).toBe('sectionHistory.revertFailed');
    expect(result.current.isReverting).toBe(false);

    await act(async () => {
      expect(await result.current.revert(1)).toBe(true);
    });
    expect(engine.runSectionBoundsEdit).toHaveBeenCalledTimes(2);
  });
});
