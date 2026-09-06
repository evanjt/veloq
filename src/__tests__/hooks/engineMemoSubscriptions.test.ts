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
import { useActivityCount } from '@/shared/native/useActivityCount';
import { useEngineSubscription } from '@/shared/native/useEngineSubscription';
import { useEngineStatus } from '@/features/routes/stores/EngineStatusStore';
import { useExcludedActivities } from '@/features/routes/hooks/useExcludedActivities';
import { useSectionChartDataEnriched } from '@/features/routes/hooks/useSectionChartDataEnriched';
import { useMuscleDetail } from '@/features/strength/hooks/useMuscleDetail';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
// `useEngine` decodes the section polyline, so it imports a value from the
// binding rather than only types, and the real module registers a TurboModule.
jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    // One point per blob, read straight off the bytes, so two different
    // blobs decode to two different points and a re-read is visible.
    decodeCoords: (buf: ArrayBuffer) => {
      const bytes = new Uint8Array(buf);
      return bytes.length >= 2 ? [{ latitude: bytes[0], longitude: bytes[1] }] : [];
    },
  })
);

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
const getSectionPolyline = jest.fn(() => new Uint8Array([1, 2]).buffer);
const getActivityCount = jest.fn(() => 12);
const getExcludedRouteActivityIds = jest.fn(() => ['act-1']);
const getExcludedRoutePerformances = jest.fn(() => ({
  performances: [
    {
      activityId: 'act-1',
      speed: 5,
      date: 1_700_000_000,
      name: 'Morning ride',
      direction: 'same',
      duration: 600,
      matchPercentage: 98,
    },
  ],
}));
const getExcludedSectionPerformances = jest.fn(() => ({
  records: [
    {
      activityId: 'act-1',
      activityName: 'Morning ride',
      activityDate: 1_700_000_000,
      laps: [{ id: 'lap-1', pace: 4 }],
    },
  ],
}));
const getMuscleDetail = jest.fn(() => ({
  slug: 'quads',
  exercises: [{ name: 'Squat', role: 'primary', sets: 3, reps: 8, volumeKg: 900 }],
  totalSets: 3,
  totalReps: 24,
  totalVolumeKg: 900,
  primaryExercises: 1,
  secondaryExercises: 0,
}));

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
  getExcludedRouteActivityIds,
  getExcludedRoutePerformances,
  getExcludedSectionPerformances,
  getMuscleDetail,
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

    getSectionPolyline.mockReturnValue(new Uint8Array([3, 4]).buffer);
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

  it('bumps the trigger when the engine only appears after it mounted', () => {
    (getEngine as jest.Mock).mockReturnValue(null);

    const { result } = renderHook(() => useEngineSubscription(['activities']));
    expect(result.current).toBe(0);

    (getEngine as jest.Mock).mockReturnValue(engine);
    act(() => useEngineStatus.getState().markEngineReady());
    expect(result.current).toBe(1);

    // A second announcement of the same handle is not a second arrival.
    act(() => useEngineStatus.getState().markEngineReady());
    expect(result.current).toBe(1);
  });

  it('re-reads a memo whose engine arrived late', () => {
    (getEngine as jest.Mock).mockReturnValue(null);

    renderHook(() => useZoneDistribution({ type: 'power', sport: 'Cycling' }));
    expect(getZoneDistribution).not.toHaveBeenCalled();

    (getEngine as jest.Mock).mockReturnValue(engine);
    act(() => useEngineStatus.getState().markEngineReady());

    expect(getZoneDistribution).toHaveBeenCalledTimes(1);
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

describe('useActivityCount', () => {
  it('re-reads the count when activities change', () => {
    const { result } = renderHook(() => useActivityCount());
    const afterMount = getActivityCount.mock.calls.length;
    expect(result.current).toBe(12);

    getActivityCount.mockReturnValue(13);
    emit('activities');

    expect(getActivityCount.mock.calls.length).toBe(afterMount + 1);
    expect(result.current).toBe(13);
  });

  it('reads zero from an engine that is not there', () => {
    (getEngine as jest.Mock).mockReturnValue(null);
    const { result } = renderHook(() => useActivityCount());
    expect(result.current).toBe(0);
  });
});

// A stable array: the hook loads the ids in an effect keyed on it, so a fresh
// literal per render would set state forever.
const PRECOMPUTED_EXCLUDED = ['act-1'];

describe('useExcludedActivities', () => {
  it('re-reads the excluded performances when sections change', () => {
    const { result } = renderHook(() =>
      useExcludedActivities('route-1', 'Ride', PRECOMPUTED_EXCLUDED)
    );
    act(() => result.current.handleToggleShowExcluded());
    const afterToggle = getExcludedRoutePerformances.mock.calls.length;
    expect(afterToggle).toBeGreaterThan(0);

    emit('sections');
    expect(getExcludedRoutePerformances.mock.calls.length).toBe(afterToggle + 1);
  });

  it('reads nothing while the excluded rows are hidden', () => {
    renderHook(() => useExcludedActivities('route-1', 'Ride', PRECOMPUTED_EXCLUDED));

    emit('sections');
    expect(getExcludedRoutePerformances).not.toHaveBeenCalled();
  });
});

describe('useSectionChartDataEnriched', () => {
  const args = {
    id: 'sec-1',
    section: null,
    chartData: [],
    showExcluded: true,
    excludedActivityIds: new Set(['act-1']),
    preComputedCalendarSummary: null,
  };

  it('re-reads the excluded performances when sections change', () => {
    renderHook(() => useSectionChartDataEnriched(args));
    const afterMount = getExcludedSectionPerformances.mock.calls.length;
    expect(afterMount).toBeGreaterThan(0);

    emit('sections');
    expect(getExcludedSectionPerformances.mock.calls.length).toBe(afterMount + 1);
  });

  it('reads nothing while the excluded rows are hidden', () => {
    renderHook(() => useSectionChartDataEnriched({ ...args, showExcluded: false }));

    emit('sections');
    expect(getExcludedSectionPerformances).not.toHaveBeenCalled();
  });
});

describe('useMuscleDetail', () => {
  it('re-reads the breakdown when activities change', () => {
    renderHook(() => useMuscleDetail('act-1', 'quads'));
    const afterMount = getMuscleDetail.mock.calls.length;
    expect(afterMount).toBeGreaterThan(0);

    emit('activities');
    expect(getMuscleDetail.mock.calls.length).toBe(afterMount + 1);
  });

  it('reads nothing without an activity', () => {
    renderHook(() => useMuscleDetail(null, 'quads'));

    emit('activities');
    expect(getMuscleDetail).not.toHaveBeenCalled();
  });
});
