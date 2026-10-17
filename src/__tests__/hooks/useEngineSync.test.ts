/**
 * Scenario: the launch sync mounts before the root layout opens the engine, so
 * the first `syncNow` reaches a null handle and never touches Rust. And once a
 * sync does start, a transient network failure used to leave the latch set for
 * the life of the process, so a relaunch was the only cure.
 *
 * Expected behaviour: the latch holds only when the call actually started a
 * sync, the engine-ready bump brings the effect back to retry, and a return
 * from the background starts a sync. A sync that failed for the connection, or
 * a start the exclusive slot refused, is the engine's to start again, so
 * neither the reconnect nor the settle asks from here.
 */

import { act, renderHook } from '@testing-library/react-native';

import { useEngineStatus } from '@/features/routes/stores/EngineStatusStore';
import { useAuthStore } from '@/shared/app/AuthStore';
import { getEngine } from '@/shared/native/engine';
import { FALLBACK_TICK_MS } from '@/shared/native/eventFallback';
import { cancelSyncRefresh } from '@/shared/native/syncRefresh';
import { useEngineSync } from '@/shared/native/useEngineSync';
import { useActivityWindowRequest } from '@/features/activity/hooks/useActivities';
import { scheduleWidgetSnapshot } from '@/features/home/lib/widgetBridge';
import { StartOutcome, SyncState, type SyncStatus } from 'veloqrs';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

let mockStatus: SyncStatus | null = null;
jest.mock('@/shared/native/useSyncStatus', () => ({
  useSyncState: () => mockStatus?.state ?? null,
  useSyncLastError: () => mockStatus?.lastError,
}));

let mockIsOnline = true;
jest.mock('@/shared/app/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: mockIsOnline }),
  useIsOnline: () => mockIsOnline,
}));

let foregroundCallback: (() => void) | null = null;
jest.mock('@/shared/app/useRetryTriggers', () => {
  const actual = jest.requireActual('@/shared/app/useRetryTriggers');
  return {
    useReconnect: actual.useReconnect,
    useForeground: (callback: () => void) => {
      foregroundCallback = callback;
    },
  };
});

jest.mock('@/features/home/lib/widgetBridge', () => ({
  scheduleWidgetSnapshot: jest.fn(),
}));

jest.mock('@/shared/native/syncRefresh', () => ({ cancelSyncRefresh: jest.fn() }));

const mockCancelSyncRefresh = cancelSyncRefresh as jest.MockedFunction<typeof cancelSyncRefresh>;
const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;
const mockScheduleWidgetSnapshot = scheduleWidgetSnapshot as jest.MockedFunction<
  typeof scheduleWidgetSnapshot
>;

/** The `syncReset` listeners the engine is holding, so a test can fire one. */
const resetListeners: (() => void)[] = [];
/** The same for `activitiesStored`, which Rust fires per activity step. */
const storedListeners: (() => void)[] = [];

function engineWith(syncNow: jest.Mock, eventsAreLive = true) {
  return {
    syncNow,
    triggerRefresh: jest.fn(),
    eventsAreLive: () => eventsAreLive,
    subscribe: jest.fn((channel: string, listener: () => void) => {
      if (channel === 'syncReset') resetListeners.push(listener);
      if (channel === 'activitiesStored') storedListeners.push(listener);
      return () => {};
    }),
  } as unknown as ReturnType<typeof getEngine>;
}

function settled(lastError?: string): SyncStatus {
  return {
    state: SyncState.Idle,
    inFlight: 0,
    completed: 0,
    total: 0,
    stepItemsDone: 0,
    stepItemsTotal: 0,
    ...(lastError !== undefined && { lastError }),
  };
}

describe('useEngineSync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStatus = null;
    mockIsOnline = true;
    foregroundCallback = null;
    resetListeners.length = 0;
    storedListeners.length = 0;
    useEngineStatus.setState({ readyNonce: 0 });
    useAuthStore.setState({ isAuthenticated: true, isDemoMode: false });
  });

  it('leaves the athlete profile to its age gate on launch and on foreground', async () => {
    const syncNow = jest.fn().mockReturnValue(StartOutcome.Started);
    mockGetEngine.mockReturnValue(engineWith(syncNow));

    await renderHook(() => useEngineSync());
    await act(() => foregroundCallback?.());

    expect(syncNow.mock.calls).toEqual([[false], [false]]);
  });

  it('retries once the engine is ready when the first call found none', async () => {
    const syncNow = jest
      .fn()
      .mockReturnValueOnce(StartOutcome.NotReady)
      .mockReturnValue(StartOutcome.Started);
    mockGetEngine.mockReturnValue(engineWith(syncNow));

    await renderHook(() => useEngineSync());
    expect(syncNow).toHaveBeenCalledTimes(1);

    await act(() => useEngineStatus.getState().markEngineReady());
    expect(syncNow).toHaveBeenCalledTimes(2);

    await act(() => useEngineStatus.getState().markEngineReady());
    expect(syncNow).toHaveBeenCalledTimes(2);
  });

  /**
   * Scenario: the observer was withheld, so `activitiesStored` never fires and
   * the feed holds its standby for the whole sync.
   */
  it('re-reads the library on a timer while the engine cannot announce', async () => {
    jest.useFakeTimers();
    const engine = engineWith(jest.fn().mockReturnValue(StartOutcome.Started), false);
    mockGetEngine.mockReturnValue(engine);
    mockStatus = {
      state: SyncState.Syncing,
      inFlight: 1,
      completed: 1,
      total: 7,
      stepItemsDone: 0,
      stepItemsTotal: 0,
    };

    await renderHook(() => useEngineSync());
    const before = (engine as unknown as { triggerRefresh: jest.Mock }).triggerRefresh.mock.calls
      .length;
    await act(() => jest.advanceTimersByTime(FALLBACK_TICK_MS * 2));

    expect(
      (engine as unknown as { triggerRefresh: jest.Mock }).triggerRefresh.mock.calls.length
    ).toBeGreaterThan(before);
    jest.useRealTimers();
  });

  it('leaves the library alone once the sync has settled', async () => {
    jest.useFakeTimers();
    const engine = engineWith(jest.fn().mockReturnValue(StartOutcome.Started), false);
    mockGetEngine.mockReturnValue(engine);
    mockStatus = settled();

    await renderHook(() => useEngineSync());
    const before = (engine as unknown as { triggerRefresh: jest.Mock }).triggerRefresh.mock.calls
      .length;
    await act(() => jest.advanceTimersByTime(FALLBACK_TICK_MS * 3));

    expect(
      (engine as unknown as { triggerRefresh: jest.Mock }).triggerRefresh.mock.calls.length
    ).toBe(before);
    jest.useRealTimers();
  });

  it('costs no timer at all while the engine can announce', async () => {
    jest.useFakeTimers();
    const engine = engineWith(jest.fn().mockReturnValue(StartOutcome.Started));
    mockGetEngine.mockReturnValue(engine);
    mockStatus = {
      state: SyncState.Syncing,
      inFlight: 1,
      completed: 1,
      total: 7,
      stepItemsDone: 0,
      stepItemsTotal: 0,
    };

    await renderHook(() => useEngineSync());
    const before = (engine as unknown as { triggerRefresh: jest.Mock }).triggerRefresh.mock.calls
      .length;
    await act(() => jest.advanceTimersByTime(FALLBACK_TICK_MS * 5));

    expect(
      (engine as unknown as { triggerRefresh: jest.Mock }).triggerRefresh.mock.calls.length
    ).toBe(before);
    jest.useRealTimers();
  });

  it('starts once when the engine is already up', async () => {
    const syncNow = jest.fn().mockReturnValue(StartOutcome.Started);
    mockGetEngine.mockReturnValue(engineWith(syncNow));

    await renderHook(() => useEngineSync());
    await act(() => useEngineStatus.getState().markEngineReady());

    expect(syncNow).toHaveBeenCalledTimes(1);
  });

  it('starts a fresh sync when the app returns from the background', async () => {
    const syncNow = jest.fn().mockReturnValue(StartOutcome.Started);
    mockGetEngine.mockReturnValue(engineWith(syncNow));

    await renderHook(() => useEngineSync());
    expect(syncNow).toHaveBeenCalledTimes(1);

    await act(() => foregroundCallback?.());
    expect(syncNow).toHaveBeenCalledTimes(2);
  });

  /**
   * Scenario: "Clear & Sync" wipes the library and announces `syncReset`. The
   * launch latch is still set from this same process, so nothing asked Rust to
   * refill it and the library stayed empty until the next cold launch.
   */
  it('syncs again after the library is cleared', async () => {
    const syncNow = jest.fn().mockReturnValue(StartOutcome.Started);
    mockGetEngine.mockReturnValue(engineWith(syncNow));

    await renderHook(() => useEngineSync());
    expect(syncNow).toHaveBeenCalledTimes(1);

    await act(() => resetListeners.forEach((fire) => fire()));

    expect(syncNow).toHaveBeenCalledTimes(2);
  });

  it('hears the clear even when the engine opened after this hook mounted', async () => {
    const syncNow = jest.fn().mockReturnValue(StartOutcome.Started);
    mockGetEngine.mockReturnValue(null);

    await renderHook(() => useEngineSync());
    expect(resetListeners).toHaveLength(0);

    mockGetEngine.mockReturnValue(engineWith(syncNow));
    await act(() => useEngineStatus.getState().markEngineReady());
    expect(syncNow).toHaveBeenCalledTimes(1);

    await act(() => resetListeners.forEach((fire) => fire()));

    expect(syncNow).toHaveBeenCalledTimes(2);
  });

  it('holds one listener, not one per retry', async () => {
    const syncNow = jest.fn().mockReturnValue(StartOutcome.Started);
    mockGetEngine.mockReturnValue(engineWith(syncNow));

    await renderHook(() => useEngineSync());
    await act(() => foregroundCallback?.());
    await act(() => foregroundCallback?.());

    expect(resetListeners).toHaveLength(1);
  });

  it('skips demo mode, which reads seeded rows', async () => {
    const syncNow = jest.fn().mockReturnValue(StartOutcome.Started);
    mockGetEngine.mockReturnValue(engineWith(syncNow));
    useAuthStore.setState({ isDemoMode: true });

    await renderHook(() => useEngineSync());

    expect(syncNow).not.toHaveBeenCalled();
  });

  it('leaves a sync that settled with an error to the engine on reconnect', async () => {
    const syncNow = jest.fn().mockReturnValue(StartOutcome.Started);
    mockGetEngine.mockReturnValue(engineWith(syncNow));

    const { rerender } = await renderHook(() => useEngineSync());
    expect(syncNow).toHaveBeenCalledTimes(1);

    mockStatus = {
      state: SyncState.Syncing,
      inFlight: 1,
      completed: 0,
      total: 1,
      stepItemsDone: 0,
      stepItemsTotal: 0,
    };
    await act(async () => await rerender(undefined));
    mockStatus = settled('connection reset');
    await act(async () => await rerender(undefined));

    mockIsOnline = false;
    await act(async () => await rerender(undefined));
    mockIsOnline = true;
    await act(async () => await rerender(undefined));

    expect(syncNow).toHaveBeenCalledTimes(1);
  });

  it('retries on foreground after a sync settled with an error', async () => {
    const syncNow = jest.fn().mockReturnValue(StartOutcome.Started);
    mockGetEngine.mockReturnValue(engineWith(syncNow));

    const { rerender } = await renderHook(() => useEngineSync());
    mockStatus = {
      state: SyncState.Syncing,
      inFlight: 1,
      completed: 0,
      total: 1,
      stepItemsDone: 0,
      stepItemsTotal: 0,
    };
    await act(async () => await rerender(undefined));
    mockStatus = settled('timed out');
    await act(async () => await rerender(undefined));

    await act(() => foregroundCallback?.());

    expect(syncNow).toHaveBeenCalledTimes(2);
  });

  it('re-syncs once per foreground return after a successful sync', async () => {
    const syncNow = jest.fn().mockReturnValue(StartOutcome.Started);
    mockGetEngine.mockReturnValue(engineWith(syncNow));

    const { rerender } = await renderHook(() => useEngineSync());
    mockStatus = {
      state: SyncState.Syncing,
      inFlight: 1,
      completed: 0,
      total: 1,
      stepItemsDone: 0,
      stepItemsTotal: 0,
    };
    await act(async () => await rerender(undefined));
    mockStatus = settled();
    await act(async () => await rerender(undefined));

    await act(() => foregroundCallback?.());
    await act(() => foregroundCallback?.());

    expect(syncNow).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['clean', undefined],
    ['failed', 'timed out'],
  ])(
    'asks for a window the slot refused once, and a %s sync leaving the slot asks nothing again',
    async (_end, lastError) => {
      // The engine keeps a window it refused as busy owed and starts it when
      // the slot frees, so an ask from here on the settled edge would be a
      // second scheduler for the same work.
      const syncNow = jest.fn().mockReturnValue(StartOutcome.Started);
      const syncActivitiesWindow = jest.fn().mockReturnValue(StartOutcome.Busy);
      mockGetEngine.mockReturnValue({
        ...engineWith(syncNow),
        syncActivitiesWindow,
      } as unknown as ReturnType<typeof getEngine>);
      useAuthStore.setState({ athleteId: 'i1' });

      const { rerender } = await renderHook(() => {
        useEngineSync();
        useActivityWindowRequest('2019-03-01', '2019-03-31');
      });
      expect(syncActivitiesWindow).toHaveBeenCalledTimes(1);

      mockStatus = {
        state: SyncState.Syncing,
        inFlight: 1,
        completed: 0,
        total: 1,
        stepItemsDone: 0,
        stepItemsTotal: 0,
      };
      await act(async () => await rerender(undefined));
      mockStatus = settled(lastError);
      await act(async () => await rerender(undefined));

      expect(syncActivitiesWindow).toHaveBeenCalledTimes(1);
    }
  );

  it('does not retry an expired credential, which no amount of network fixes', async () => {
    const syncNow = jest.fn().mockReturnValue(StartOutcome.Started);
    mockGetEngine.mockReturnValue(engineWith(syncNow));

    const { rerender } = await renderHook(() => useEngineSync());
    mockStatus = {
      state: SyncState.Syncing,
      inFlight: 1,
      completed: 0,
      total: 1,
      stepItemsDone: 0,
      stepItemsTotal: 0,
    };
    await act(async () => await rerender(undefined));
    mockStatus = {
      state: SyncState.AuthExpired,
      inFlight: 0,
      completed: 0,
      total: 0,
      stepItemsDone: 0,
      stepItemsTotal: 0,
      lastError: '401',
    };
    await act(async () => await rerender(undefined));

    await act(() => foregroundCallback?.());

    expect(syncNow).toHaveBeenCalledTimes(1);
  });
  it('refreshes the widget when a sync settles, not while it runs', async () => {
    // The widget only had two writers, backgrounding and the silent-push task,
    // so a foreground sync left yesterday's numbers on the home screen until
    // the app was backgrounded.
    const syncNow = jest.fn().mockReturnValue(StartOutcome.Started);
    mockGetEngine.mockReturnValue(engineWith(syncNow));

    const { rerender } = await renderHook(() => useEngineSync());
    mockStatus = {
      state: SyncState.Syncing,
      inFlight: 1,
      completed: 0,
      total: 1,
      stepItemsDone: 0,
      stepItemsTotal: 0,
    };
    await act(() => rerender(undefined));
    expect(mockScheduleWidgetSnapshot).not.toHaveBeenCalled();

    mockStatus = settled();
    await act(async () => await rerender(undefined));

    expect(mockScheduleWidgetSnapshot).toHaveBeenCalledTimes(1);
  });

  it('refreshes the widget after a sync that settled with an error', async () => {
    // A sync that failed part-way still wrote the activities it did fetch, so
    // the widget is stale rather than correct if the error skips it.
    const syncNow = jest.fn().mockReturnValue(StartOutcome.Started);
    mockGetEngine.mockReturnValue(engineWith(syncNow));

    const { rerender } = await renderHook(() => useEngineSync());
    mockStatus = {
      state: SyncState.Syncing,
      inFlight: 1,
      completed: 3,
      total: 9,
      stepItemsDone: 0,
      stepItemsTotal: 0,
    };
    await act(async () => await rerender(undefined));
    mockStatus = settled('connection reset');
    await act(async () => await rerender(undefined));

    expect(mockScheduleWidgetSnapshot).toHaveBeenCalledTimes(1);
  });

  it('leaves the widget alone when no sync ever ran', async () => {
    const syncNow = jest.fn().mockReturnValue(StartOutcome.Started);
    mockGetEngine.mockReturnValue(engineWith(syncNow));

    const { rerender } = await renderHook(() => useEngineSync());
    mockStatus = settled();
    await act(async () => await rerender(undefined));

    expect(mockScheduleWidgetSnapshot).not.toHaveBeenCalled();
  });

  it('refreshes the widget once per sync, not once per settled render', async () => {
    const syncNow = jest.fn().mockReturnValue(StartOutcome.Started);
    mockGetEngine.mockReturnValue(engineWith(syncNow));

    const { rerender } = await renderHook(() => useEngineSync());
    mockStatus = {
      state: SyncState.Syncing,
      inFlight: 1,
      completed: 0,
      total: 1,
      stepItemsDone: 0,
      stepItemsTotal: 0,
    };
    await act(async () => await rerender(undefined));
    mockStatus = settled();
    await act(async () => await rerender(undefined));
    await act(async () => await rerender(undefined));

    expect(mockScheduleWidgetSnapshot).toHaveBeenCalledTimes(1);
  });

  /**
   * Scenario: a pull to refresh is refused while a sync runs and held for the
   * next settle. The athlete then signs out, or clears the library, and the
   * hold outlives the account it was made for.
   */
  it('drops a held refresh on sign-out', async () => {
    const syncNow = jest.fn().mockReturnValue(StartOutcome.Started);
    mockGetEngine.mockReturnValue(engineWith(syncNow));

    const { rerender } = await renderHook(() => useEngineSync());
    expect(mockCancelSyncRefresh).not.toHaveBeenCalled();

    await act(() => useAuthStore.setState({ isAuthenticated: false }));
    await rerender(undefined);

    expect(mockCancelSyncRefresh).toHaveBeenCalledTimes(1);
  });

  it('drops a held refresh when the library is cleared', async () => {
    const syncNow = jest.fn().mockReturnValue(StartOutcome.Started);
    mockGetEngine.mockReturnValue(engineWith(syncNow));

    await renderHook(() => useEngineSync());

    await act(() => resetListeners.forEach((fire) => fire()));

    expect(mockCancelSyncRefresh).toHaveBeenCalledTimes(1);
  });

  /**
   * Scenario: the athlete logs out and back in as someone else while a sync is
   * in flight. `clear_credentials` only soft-cancels, so the old sync still
   * holds the exclusive slot and the new athlete's first `syncNow` is refused.
   *
   * Expected behaviour: the engine keeps the refused start owed and starts it
   * when the slot frees, so the settle asks nothing from here.
   */
  it('leaves a start the slot refused to the engine when the sync settles', async () => {
    const syncNow = jest
      .fn()
      .mockReturnValueOnce(StartOutcome.Busy)
      .mockReturnValue(StartOutcome.Started);
    mockGetEngine.mockReturnValue(engineWith(syncNow));

    const { rerender } = await renderHook(() => useEngineSync());
    expect(syncNow).toHaveBeenCalledTimes(1);

    mockStatus = {
      state: SyncState.Syncing,
      inFlight: 1,
      completed: 0,
      total: 1,
      stepItemsDone: 0,
      stepItemsTotal: 0,
    };
    await act(async () => await rerender(undefined));
    mockStatus = settled();
    await act(async () => await rerender(undefined));

    expect(syncNow).toHaveBeenCalledTimes(1);
  });

  /**
   * Scenario: a first launch. Rust asks for the newest owed activities before
   * the profile slice, so their rows are in SQLite seconds in, and the settle
   * is the rest of the library, the curves and every owed interval body away.
   *
   * Expected behaviour: the activity step's announcement wakes the same
   * readers the settle does, so the feed paints and the preview fetch starts
   * on the rows rather than on the job.
   */
  it('wakes the activity readers when a sync step lands its rows', async () => {
    const engine = engineWith(jest.fn().mockReturnValue(StartOutcome.Started));
    mockGetEngine.mockReturnValue(engine);

    await renderHook(() => useEngineSync());
    expect(engine?.triggerRefresh).not.toHaveBeenCalled();

    await act(() => storedListeners.forEach((listener) => listener()));

    expect(engine?.triggerRefresh).toHaveBeenCalledWith('activities');
  });

  it('asks nothing on the settle of a sync that failed', async () => {
    // The credential may be the thing that failed, and asking again straight
    // away hammers a 401 on every settle.
    const syncNow = jest.fn().mockReturnValue(StartOutcome.Started);
    mockGetEngine.mockReturnValue(engineWith(syncNow));

    const { rerender } = await renderHook(() => useEngineSync());
    mockStatus = {
      state: SyncState.Syncing,
      inFlight: 1,
      completed: 0,
      total: 1,
      stepItemsDone: 0,
      stepItemsTotal: 0,
    };
    await act(async () => await rerender(undefined));
    mockStatus = settled('connection reset');
    await act(async () => await rerender(undefined));

    expect(syncNow).toHaveBeenCalledTimes(1);
  });
});
