/**
 * Scenario: hooks that read the engine inside a useMemo keyed on their inputs
 * alone. Nothing re-reads them, so a sync, a trim or a rename never reaches
 * the screen.
 *
 * Expected behaviour: each one subscribes to the engine event that announces
 * its own data, and re-reads when it fires.
 */

import { renderHook, act } from '@testing-library/react-native';

import { getEngine } from '@/shared/native/engine';
import { useZoneDistribution } from '@/features/fitness/hooks/useZoneDistribution';
import { useSectionDetail, useSectionPolyline } from '@/features/routes/hooks/useEngine';
import { useCacheDays } from '@/shared/app/useCacheDays';
import { useEngineSubscription } from '@/shared/native/useEngineSubscription';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));

jest.mock('@/shared/app/SyncDateRangeStore', () => ({
  useSyncDateRange: (selector: (s: { oldest: string; newest: string }) => unknown) =>
    selector({ oldest: '2026-01-01', newest: '2026-01-10' }),
}));

jest.mock('@/features/routes/lib/sectionConversions', () => ({
  convertNativeSectionToApp: (native: { id: string; name: string }) => ({ ...native }),
}));

const listeners = new Map<string, Set<() => void>>();

const getZoneDistribution = jest.fn(() => [600, 300, 100, 0, 0]);
const getSectionById = jest.fn((id: string) => ({ id, name: 'Church Hill' }));
const getSectionPolyline = jest.fn(() => [{ latitude: 1, longitude: 2 }]);
const getActivityCount = jest.fn(() => 12);

const engine = {
  subscribe: (event: string, cb: () => void) => {
    const set = listeners.get(event) ?? new Set<() => void>();
    set.add(cb);
    listeners.set(event, set);
    return () => set.delete(cb);
  },
  getZoneDistribution,
  getSectionById,
  getSectionPolyline,
  getActivityCount,
};

function emit(event: string) {
  act(() => {
    listeners.get(event)?.forEach((cb) => cb());
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  listeners.clear();
  (getEngine as jest.Mock).mockReturnValue(engine);
});

describe('useZoneDistribution', () => {
  it('re-reads the zone totals when activities change', () => {
    renderHook(() => useZoneDistribution({ type: 'power', sport: 'Cycling' }));
    const afterMount = getZoneDistribution.mock.calls.length;
    expect(afterMount).toBeGreaterThan(0);

    emit('activities');
    expect(getZoneDistribution.mock.calls.length).toBe(afterMount + 1);

    emit('activities');
    expect(getZoneDistribution.mock.calls.length).toBe(afterMount + 2);
  });

  it('reads nothing without a sport, however many events fire', () => {
    renderHook(() => useZoneDistribution({ type: 'hr' }));

    emit('activities');
    expect(getZoneDistribution).not.toHaveBeenCalled();
  });
});

describe('useSectionDetail', () => {
  it('re-reads the section when sections change', () => {
    const { result } = renderHook(() => useSectionDetail('sec-1'));
    const afterMount = getSectionById.mock.calls.length;
    expect(result.current.section?.name).toBe('Church Hill');

    getSectionById.mockImplementation((id: string) => ({ id, name: 'Church Hill Climb' }));
    emit('sections');

    expect(getSectionById.mock.calls.length).toBe(afterMount + 1);
    expect(result.current.section?.name).toBe('Church Hill Climb');
  });

  it('ignores an event it does not depend on', () => {
    renderHook(() => useSectionDetail('sec-1'));
    const afterMount = getSectionById.mock.calls.length;

    emit('groups');
    expect(getSectionById.mock.calls.length).toBe(afterMount);
  });

  it('reads nothing without a section id', () => {
    renderHook(() => useSectionDetail(null));

    emit('sections');
    expect(getSectionById).not.toHaveBeenCalled();
  });
});

describe('useSectionPolyline', () => {
  it('re-reads the polyline when sections change', () => {
    const { result } = renderHook(() => useSectionPolyline('sec-1'));
    const afterMount = getSectionPolyline.mock.calls.length;
    expect(result.current.polyline).toEqual([{ lat: 1, lng: 2 }]);

    getSectionPolyline.mockReturnValue([{ latitude: 3, longitude: 4 }]);
    emit('sections');

    expect(getSectionPolyline.mock.calls.length).toBe(afterMount + 1);
    expect(result.current.polyline).toEqual([{ lat: 3, lng: 4 }]);
  });

  it('survives a throwing engine and still re-reads on the next event', () => {
    getSectionPolyline.mockImplementation(() => {
      throw new Error('engine down');
    });
    const { result } = renderHook(() => useSectionPolyline('sec-1'));
    expect(result.current.polyline).toEqual([]);

    const afterMount = getSectionPolyline.mock.calls.length;
    emit('sections');
    expect(getSectionPolyline.mock.calls.length).toBe(afterMount + 1);
  });
});

describe('useCacheDays', () => {
  it('re-reads the activity count when activities change', () => {
    renderHook(() => useCacheDays());
    const afterMount = getActivityCount.mock.calls.length;
    expect(afterMount).toBeGreaterThan(0);

    emit('activities');
    expect(getActivityCount.mock.calls.length).toBe(afterMount + 1);
  });

  it('asks the engine for nothing when the count is precomputed', () => {
    const { result } = renderHook(() => useCacheDays(7));

    emit('activities');
    expect(getActivityCount).not.toHaveBeenCalled();
    expect(result.current).toBe(10);
  });
});

describe('useEngineSubscription', () => {
  it('leaves the trigger alone when the engine is there on the first attempt', () => {
    const { result } = renderHook(() => useEngineSubscription(['activities']));
    expect(result.current).toBe(0);
  });

  it('reads once at mount when the engine is available', () => {
    renderHook(() => useZoneDistribution({ type: 'power', sport: 'Cycling' }));
    expect(getZoneDistribution).toHaveBeenCalledTimes(1);
  });

  it('bumps the trigger when the engine only appears after the poll starts', () => {
    jest.useFakeTimers();
    (getEngine as jest.Mock).mockReturnValue(null);

    const { result } = renderHook(() => useEngineSubscription(['activities']));
    expect(result.current).toBe(0);

    act(() => {
      jest.advanceTimersByTime(200);
    });
    expect(result.current).toBe(0);

    (getEngine as jest.Mock).mockReturnValue(engine);
    act(() => {
      jest.advanceTimersByTime(200);
    });
    expect(result.current).toBe(1);

    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(1);

    jest.useRealTimers();
  });

  it('re-reads a memo whose engine arrived late', () => {
    jest.useFakeTimers();
    (getEngine as jest.Mock).mockReturnValue(null);

    renderHook(() => useZoneDistribution({ type: 'power', sport: 'Cycling' }));
    expect(getZoneDistribution).not.toHaveBeenCalled();

    (getEngine as jest.Mock).mockReturnValue(engine);
    act(() => {
      jest.advanceTimersByTime(200);
    });
    expect(getZoneDistribution).toHaveBeenCalledTimes(1);

    jest.useRealTimers();
  });

  it('still bumps on every event after the first subscribe', () => {
    const { result } = renderHook(() => useEngineSubscription(['activities']));

    emit('activities');
    expect(result.current).toBe(1);

    emit('activities');
    expect(result.current).toBe(2);
  });

  it('subscribes to nothing and never bumps when given no events', () => {
    const { result } = renderHook(() => useEngineSubscription([]));

    emit('activities');
    expect(result.current).toBe(0);
  });

  it('drops its listeners on unmount', () => {
    const { unmount } = renderHook(() => useEngineSubscription(['activities']));
    expect(listeners.get('activities')?.size).toBe(1);

    unmount();
    expect(listeners.get('activities')?.size).toBe(0);
  });
});
