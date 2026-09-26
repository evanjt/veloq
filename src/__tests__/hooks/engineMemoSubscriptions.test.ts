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
import { useLibraryCoverage } from '@/shared/native/useLibraryCoverage';
import { useRangeCoverage } from '@/shared/native/useRangeCoverage';
import { RangeCoverage } from 'veloqrs';
import { useEngineSubscription } from '@/shared/native/useEngineSubscription';
import { useEngineStatus } from '@/features/routes/stores/EngineStatusStore';
import { useExcludedActivities } from '@/features/routes/hooks/useExcludedActivities';
import { useSectionChartDataEnriched } from '@/features/routes/hooks/useSectionChartDataEnriched';
import { useMuscleDetail } from '@/features/strength/hooks/useMuscleDetail';
import { useDetailCoordinates } from '@/features/activity/hooks/useDetailCoordinates';
import { useStoredPaceTrend } from '@/features/fitness/hooks/useStoredPaceTrend';
import { useSectionDetailPerformance } from '@/features/routes/hooks/useSectionDetailData';
import { useWorkoutSections } from '@/features/home/hooks/useWorkoutSections';
import { useLedgerActivityNames } from '@/features/routes/hooks/useLedgerActivityNames';
import { useStrengthTabState } from '@/features/strength/hooks/useStrengthScreenData';
import { useEngineMapActivities } from '@/features/maps/hooks/useEngineMapActivities';
import { useActivityDetailData } from '@/features/activity/hooks/useActivityDetailData';

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
const libraryCoverage = jest.fn(() => ({ upstream: 400, local: 120 }));
const rangeCoverage = jest.fn(() => RangeCoverage.NotFetched);
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
const getGpsTrack = jest.fn(() => new Uint8Array([7, 8]).buffer);
const getSectionDetailPerformance = jest.fn(() => ({ records: [], chart: [] }));
const getSummaryCardData = jest.fn(() => ({
  runPaceTrend: { latestPace: 3.5 },
  swimPaceTrend: { latestPace: 1.2 },
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

const getWorkoutSections = jest.fn(() => [
  { id: 'sec-1', name: 'Church Hill', prTimeSecs: 240, trend: 1 },
]);
const getActivityNames = jest.fn(() => [{ activityId: 'act-1', name: 'Morning ride' }]);
const hasStrengthData = jest.fn(() => false);
const getMapScreenData = jest.fn(() => ({
  activityCount: 1,
  availableSportTypes: ['Ride'],
  activities: [
    {
      activityId: 'act-1',
      bounds: { minLat: 1, maxLat: 2, minLng: 3, maxLng: 4 },
      sportType: 'Ride',
      name: 'Morning ride',
      date: 1_700_000_000n,
      distance: 1000,
      duration: 600,
      startLat: 1,
      startLng: 3,
    },
  ],
}));
const getActivityDetailData = jest.fn(() => ({
  activityCount: 1,
  sectionCount: 1,
  routeGroups: [],
  matchedSections: [],
  customSections: [],
  encounters: [],
  highlights: { indicators: [], routeHighlights: [] },
  sectionTraces: [],
  prSectionIds: [],
}));
const getUnprocessedStrengthIds = jest.fn(() => ['act-9']);

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
  libraryCoverage,
  rangeCoverage,
  getExcludedRouteActivityIds,
  getExcludedRoutePerformances,
  getExcludedSectionPerformances,
  getMuscleDetail,
  getGpsTrack,
  getSectionDetailPerformance,
  getSummaryCardData,
  getWorkoutSections,
  getActivityNames,
  hasStrengthData,
  getUnprocessedStrengthIds,
  getMapScreenData,
  getActivityDetailData,
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

describe('useLibraryCoverage', () => {
  it('re-reads the coverage when activities change', () => {
    const { result } = renderHook(() => useLibraryCoverage());
    const afterMount = libraryCoverage.mock.calls.length;
    expect(result.current).toEqual({ upstream: 400, local: 120 });

    libraryCoverage.mockReturnValue({ upstream: 400, local: 400 });
    emit('activities');

    expect(libraryCoverage.mock.calls.length).toBe(afterMount + 1);
    expect(result.current).toEqual({ upstream: 400, local: 400 });
  });

  it('reports nothing from an engine that is not there', () => {
    (getEngine as jest.Mock).mockReturnValue(null);
    const { result } = renderHook(() => useLibraryCoverage());
    expect(result.current).toBeNull();
  });
});

describe('useRangeCoverage', () => {
  it('re-reads the window when activities change', () => {
    const { result } = renderHook(() => useRangeCoverage(30));
    const afterMount = rangeCoverage.mock.calls.length;
    expect(result.current).toBe(RangeCoverage.NotFetched);

    rangeCoverage.mockReturnValue(RangeCoverage.Loaded);
    emit('activities');

    expect(rangeCoverage.mock.calls.length).toBe(afterMount + 1);
    expect(result.current).toBe(RangeCoverage.Loaded);
  });

  it('answers ignorance from an engine that is not there', () => {
    (getEngine as jest.Mock).mockReturnValue(null);
    const { result } = renderHook(() => useRangeCoverage(30));
    expect(result.current).toBe(RangeCoverage.NotFetched);
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

describe('useDetailCoordinates', () => {
  it('re-reads the stored track when the bulk ingest announces one', () => {
    const { result } = renderHook(() => useDetailCoordinates('act-1', undefined));
    const afterMount = getGpsTrack.mock.calls.length;
    expect(result.current).toEqual([{ latitude: 7, longitude: 8 }]);

    getGpsTrack.mockReturnValue(new Uint8Array([9, 10]).buffer);
    emit('activities');

    expect(getGpsTrack.mock.calls.length).toBe(afterMount + 1);
    expect(result.current).toEqual([{ latitude: 9, longitude: 10 }]);
  });

  it('leaves the stored track unread while the stream body is to hand', () => {
    renderHook(() => useDetailCoordinates('act-1', [[1, 2]]));

    emit('activities');
    expect(getGpsTrack).not.toHaveBeenCalled();
  });

  it('reads nothing without an activity id', () => {
    renderHook(() => useDetailCoordinates('', undefined));

    emit('activities');
    expect(getGpsTrack).not.toHaveBeenCalled();
  });
});

describe('useStoredPaceTrend', () => {
  it('re-reads the stored pace when activities change', () => {
    const { result } = renderHook(() => useStoredPaceTrend('Run'));
    const afterMount = getSummaryCardData.mock.calls.length;
    expect(result.current).toBe(3.5);

    getSummaryCardData.mockReturnValue({
      runPaceTrend: { latestPace: 3.8 },
      swimPaceTrend: { latestPace: 1.2 },
    });
    emit('activities');

    expect(getSummaryCardData.mock.calls.length).toBe(afterMount + 1);
    expect(result.current).toBe(3.8);
  });

  it('reads null from a throwing engine and still re-reads on the next event', () => {
    getSummaryCardData.mockImplementation(() => {
      throw new Error('engine down');
    });
    const { result } = renderHook(() => useStoredPaceTrend('Swim'));
    expect(result.current).toBeNull();

    const afterMount = getSummaryCardData.mock.calls.length;
    emit('activities');
    expect(getSummaryCardData.mock.calls.length).toBe(afterMount + 1);
  });

  it('reads null when the engine is not open', () => {
    (getEngine as jest.Mock).mockReturnValue(undefined);
    const { result } = renderHook(() => useStoredPaceTrend('Run'));

    expect(result.current).toBeNull();
  });

  /**
   * The window and the day it is keyed on came from two separate clock reads,
   * so a render that straddled midnight asked for one day's window under the
   * other day's key.
   */
  it('asks for the week the day it is keyed on falls in', () => {
    jest.useFakeTimers({ doNotFake: ['nextTick'] });
    // A Wednesday, so the week runs Monday the 9th to Sunday the 15th.
    jest.setSystemTime(new Date(2026, 8, 11, 13, 0, 0));

    renderHook(() => useStoredPaceTrend('Run'));

    const [weekStart, weekEnd, prevStart] = getSummaryCardData.mock.calls[0] as number[];
    expect(new Date(weekStart * 1000).toISOString().slice(0, 10)).toBe('2026-09-07');
    expect(new Date(weekEnd * 1000).toISOString().slice(0, 10)).toBe('2026-09-13');
    expect(new Date(prevStart * 1000).toISOString().slice(0, 10)).toBe('2026-08-31');
    jest.useRealTimers();
  });
});

describe('useWorkoutSections', () => {
  it('re-reads the list when sections change', () => {
    const { result } = renderHook(() => useWorkoutSections('Ride'));
    const afterMount = getWorkoutSections.mock.calls.length;
    expect(result.current.sections[0].name).toBe('Church Hill');

    getWorkoutSections.mockReturnValue([
      { id: 'sec-2', name: 'Canal Path', prTimeSecs: 300, trend: -1 },
    ]);
    emit('sections');

    expect(getWorkoutSections.mock.calls.length).toBe(afterMount + 1);
    expect(result.current.sections[0].name).toBe('Canal Path');
  });

  it('asks the engine for nothing without a sport', () => {
    renderHook(() => useWorkoutSections(undefined));
    emit('sections');

    expect(getWorkoutSections).not.toHaveBeenCalled();
  });

  it('reads an empty list when the engine is not open', () => {
    (getEngine as jest.Mock).mockReturnValue(undefined);
    const { result } = renderHook(() => useWorkoutSections('Ride'));

    expect(result.current.sections).toEqual([]);
  });
});

describe('useLedgerActivityNames', () => {
  const history = [{ details: JSON.stringify({ around: ['act-1'] }) }];

  it('re-reads the names when activities change', () => {
    const { result } = renderHook(() =>
      useLedgerActivityNames(history as unknown as Parameters<typeof useLedgerActivityNames>[0])
    );
    const afterMount = getActivityNames.mock.calls.length;
    expect(result.current['act-1']).toBe('Morning ride');

    getActivityNames.mockReturnValue([{ activityId: 'act-1', name: 'Evening ride' }]);
    emit('activities');

    expect(getActivityNames.mock.calls.length).toBe(afterMount + 1);
    expect(result.current['act-1']).toBe('Evening ride');
  });

  it('reads nothing when the history names no chip', () => {
    renderHook(() => useLedgerActivityNames([]));
    emit('activities');

    expect(getActivityNames).not.toHaveBeenCalled();
  });
});

describe('useStrengthTabState', () => {
  it('re-reads the tab state when a FIT lands', () => {
    const { result } = renderHook(() => useStrengthTabState());
    expect(result.current).toBe('awaiting');

    hasStrengthData.mockReturnValue(true);
    emit('fitParsed');

    expect(result.current).toBe('ready');
  });

  it('re-reads on the activities channel as well', () => {
    renderHook(() => useStrengthTabState());
    const afterMount = hasStrengthData.mock.calls.length;

    emit('activities');

    expect(hasStrengthData.mock.calls.length).toBe(afterMount + 1);
  });

  it('is hidden when the engine is not open', () => {
    (getEngine as jest.Mock).mockReturnValue(undefined);
    const { result } = renderHook(() => useStrengthTabState());

    expect(result.current).toBe('hidden');
  });
});

describe('useEngineMapActivities', () => {
  const range = {
    startDate: new Date('2026-01-01'),
    endDate: new Date('2026-01-31'),
    selectedTypes: new Set<string>(),
  };

  it('re-reads the map window when activities change', () => {
    const { result } = renderHook(() => useEngineMapActivities(range));
    const afterMount = getMapScreenData.mock.calls.length;
    expect(afterMount).toBeGreaterThan(0);
    expect(result.current.activities).toHaveLength(1);

    emit('activities');
    expect(getMapScreenData.mock.calls.length).toBe(afterMount + 1);
  });

  it('reads nothing while it is disabled, however many events fire', () => {
    renderHook(() => useEngineMapActivities({ ...range, enabled: false }));

    emit('activities');
    expect(getMapScreenData).not.toHaveBeenCalled();
  });

  it('is empty when the engine is not open', () => {
    (getEngine as jest.Mock).mockReturnValue(undefined);
    const { result } = renderHook(() => useEngineMapActivities(range));

    expect(result.current.activities).toEqual([]);
    expect(result.current.isReady).toBe(false);
  });
});

describe('useActivityDetailData', () => {
  it('re-reads the bundle when sections change', () => {
    const { result } = renderHook(() => useActivityDetailData('act-1'));
    const afterMount = getActivityDetailData.mock.calls.length;
    expect(afterMount).toBeGreaterThan(0);
    expect(result.current.data?.activityCount).toBe(1);

    emit('sections');
    expect(getActivityDetailData.mock.calls.length).toBe(afterMount + 1);
  });

  it('reads nothing while it is disabled', () => {
    renderHook(() => useActivityDetailData('act-1', false));

    emit('activities');
    expect(getActivityDetailData).not.toHaveBeenCalled();
  });

  it('holds no bundle when the engine is not open', () => {
    (getEngine as jest.Mock).mockReturnValue(undefined);
    const { result } = renderHook(() => useActivityDetailData('act-1'));

    expect(result.current.data).toBeNull();
  });
});

describe('useSectionDetailPerformance', () => {
  it('re-reads the records when sections change', () => {
    renderHook(() => useSectionDetailPerformance('sec-1', 90, undefined, true));
    const afterMount = getSectionDetailPerformance.mock.calls.length;
    expect(afterMount).toBeGreaterThan(0);

    emit('sections');
    expect(getSectionDetailPerformance.mock.calls.length).toBe(afterMount + 1);
  });

  it('reads nothing while the time streams are still being fetched', () => {
    renderHook(() => useSectionDetailPerformance('sec-1', 90, undefined, false));

    emit('sections');
    expect(getSectionDetailPerformance).not.toHaveBeenCalled();
  });

  it('survives a throwing engine and still re-reads on the next event', () => {
    getSectionDetailPerformance.mockImplementation(() => {
      throw new Error('engine down');
    });
    const { result } = renderHook(() => useSectionDetailPerformance('sec-1', 90, undefined, true));
    expect(result.current).toBeNull();

    const afterMount = getSectionDetailPerformance.mock.calls.length;
    emit('sections');
    expect(getSectionDetailPerformance.mock.calls.length).toBe(afterMount + 1);
  });
});
