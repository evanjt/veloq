/**
 * Scenario: the launch sync mounts before the root layout opens the engine, so
 * the first `syncNow` reaches a null handle and never touches Rust. And once a
 * sync does start, a transient network failure used to leave the latch set for
 * the life of the process, so a relaunch was the only cure.
 *
 * Expected behaviour: the latch holds only when the call actually started a
 * sync, the engine-ready bump brings the effect back to retry, and a sync that
 * settled with an error retries on the next reconnect or foreground.
 */

import { act, renderHook } from '@testing-library/react-native';

import { useEngineStatus } from '@/features/routes/stores/EngineStatusStore';
import { useAuthStore } from '@/shared/app/AuthStore';
import { getEngine } from '@/shared/native/engine';
import { FALLBACK_TICK_MS } from '@/shared/native/eventFallback';
import { cancelSyncRefresh } from '@/shared/native/syncRefresh';
import { useEngineSync } from '@/shared/native/useEngineSync';
import { useSyncSettled } from '@/shared/app/useRetryTriggers';
import { updateWidgetSnapshot } from '@/features/home/lib/widgetBridge';
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
    useSyncSettled: actual.useSyncSettled,
    emitSyncSettled: actual.emitSyncSettled,
    useForeground: (callback: () => void) => {
      foregroundCallback = callback;
    },
  };
});

jest.mock('@/features/home/lib/widgetBridge', () => ({
  updateWidgetSnapshot: jest.fn(),
}));

jest.mock('@/shared/native/syncRefresh', () => ({ cancelSyncRefresh: jest.fn() }));

const mockCancelSyncRefresh = cancelSyncRefresh as jest.MockedFunction<typeof cancelSyncRefresh>;
const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;
const mockUpdateWidgetSnapshot = updateWidgetSnapshot as jest.MockedFunction<
  typeof updateWidgetSnapshot
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

  it('retries once the engine is ready when the first call found none', () => {
    const syncNow = jest
      .fn()
      .mockReturnValueOnce(StartOutcome.NotReady)
      .mockReturnValue(StartOutcome.Started);
    mockGetEngine.mockReturnValue(engineWith(syncNow));

    renderHook(() => useEngineSync());
    expect(syncNow).toHaveBeenCalledTimes(1);

    act(() => useEngineStatus.getState().markEngineReady());
    expect(syncNow).toHaveBeenCalledTimes(2);

    act(() => useEngineStatus.getState().markEngineReady());
    expect(syncNow).toHaveBeenCalledTimes(2);
  });

  /**
   * Scenario: the observer was withheld, so `activitiesStored` never fires and
   * the feed holds its standby for the whole sync.
   */
  it('re-reads the library on a timer while the engine cannot announce', () => {
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

    renderHook(() => useEngineSync());
    const before = (engine as unknown as { triggerRefresh: jest.Mock }).triggerRefresh.mock.calls
      .length;
    act(() => jest.advanceTimersByTime(FALLBACK_TICK_MS * 2));

    expect(
      (engine as unknown as { triggerRefresh: jest.Mock }).triggerRefresh.mock.calls.length
    ).toBeGreaterThan(before);
    jest.useRealTimers();
  });

  it('leaves the library alone once the sync has settled', () => {
    jest.useFakeTimers();
    const engine = engineWith(jest.fn().mockReturnValue(StartOutcome.Started), false);
    mockGetEngine.mockReturnValue(engine);
    mockStatus = settled();

    renderHook(() => useEngineSync());
    const before = (engine as unknown as { triggerRefresh: jest.Mock }).triggerRefresh.mock.calls
      .length;
    act(() => jest.advanceTimersByTime(FALLBACK_TICK_MS * 3));

    expect(
      (engine as unknown as { triggerRefresh: jest.Mock }).triggerRefresh.mock.calls.length
    ).toBe(before);
    jest.useRealTimers();
  });

  it('costs no timer at all while the engine can announce', () => {
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

    renderHook(() => useEngineSync());
    const before = (engine as unknown as { triggerRefresh: jest.Mock }).triggerRefresh.mock.calls
      .length;
    act(() => jest.advanceTimersByTime(FALLBACK_TICK_MS * 5));

    expect(
      (engine as unknown as { triggerRefresh: jest.Mock }).triggerRefresh.mock.calls.length
    ).toBe(before);
    jest.useRealTimers();
  });

  it('starts once when the engine is already up', () => {
    const syncNow = jest.fn().mockReturnValue(StartOutcome.Started);
    mockGetEngine.mockReturnValue(engineWith(syncNow));

    renderHook(() => useEngineSync());
    act(() => useEngineStatus.getState().markEngineReady());

    expect(syncNow).toHaveBeenCalledTimes(1);
  });

  it('starts a fresh sync when the app returns from the background', () => {
    const syncNow = jest.fn().mockReturnValue(StartOutcome.Started);
    mockGetEngine.mockReturnValue(engineWith(syncNow));

    renderHook(() => useEngineSync());
    expect(syncNow).toHaveBeenCalledTimes(1);

    act(() => foregroundCallback?.());
    expect(syncNow).toHaveBeenCalledTimes(2);
  });

  /**
   * Scenario: "Clear & Sync" wipes the library and announces `syncReset`. The
   * launch latch is still set from this same process, so nothing asked Rust to
   * refill it and the library stayed empty until the next cold launch.
   */
  it('syncs again after the library is cleared', () => {
    const syncNow = jest.fn().mockReturnValue(StartOutcome.Started);
    mockGetEngine.mockReturnValue(engineWith(syncNow));

    renderHook(() => useEngineSync());
    expect(syncNow).toHaveBeenCalledTimes(1);

    act(() => resetListeners.forEach((fire) => fire()));

    expect(syncNow).toHaveBeenCalledTimes(2);
  });

  it('hears the clear even when the engine opened after this hook mounted', () => {
    const syncNow = jest.fn().mockReturnValue(StartOutcome.Started);
    mockGetEngine.mockReturnValue(null);

    renderHook(() => useEngineSync());
    expect(resetListeners).toHaveLength(0);

    mockGetEngine.mockReturnValue(engineWith(syncNow));
    act(() => useEngineStatus.getState().markEngineReady());
    expect(syncNow).toHaveBeenCalledTimes(1);

    act(() => resetListeners.forEach((fire) => fire()));

    expect(syncNow).toHaveBeenCalledTimes(2);
  });

  it('holds one listener, not one per retry', () => {
    const syncNow = jest.fn().mockReturnValue(StartOutcome.Started);
    mockGetEngine.mockReturnValue(engineWith(syncNow));

    renderHook(() => useEngineSync());
    act(() => foregroundCallback?.());
    act(() => foregroundCallback?.());

    expect(resetListeners).toHaveLength(1);
  });

  it('skips demo mode, which reads seeded rows', () => {
    const syncNow = jest.fn().mockReturnValue(StartOutcome.Started);
    mockGetEngine.mockReturnValue(engineWith(syncNow));
    useAuthStore.setState({ isDemoMode: true });

    renderHook(() => useEngineSync());

    expect(syncNow).not.toHaveBeenCalled();
  });

  it('retries on reconnect after a sync settled with an error', () => {
    const syncNow = jest.fn().mockReturnValue(StartOutcome.Started);
    mockGetEngine.mockReturnValue(engineWith(syncNow));

    const { rerender } = renderHook(() => useEngineSync());
    expect(syncNow).toHaveBeenCalledTimes(1);

    mockStatus = {
      state: SyncState.Syncing,
      inFlight: 1,
      completed: 0,
      total: 1,
      stepItemsDone: 0,
      stepItemsTotal: 0,
    };
    act(() => rerender(undefined));
    mockStatus = settled('connection reset');
    act(() => rerender(undefined));

    mockIsOnline = false;
    act(() => rerender(undefined));
    mockIsOnline = true;
    act(() => rerender(undefined));

    expect(syncNow).toHaveBeenCalledTimes(2);
  });

  it('retries on foreground after a sync settled with an error', () => {
    const syncNow = jest.fn().mockReturnValue(StartOutcome.Started);
    mockGetEngine.mockReturnValue(engineWith(syncNow));

    const { rerender } = renderHook(() => useEngineSync());
    mockStatus = {
      state: SyncState.Syncing,
      inFlight: 1,
      completed: 0,
      total: 1,
      stepItemsDone: 0,
      stepItemsTotal: 0,
    };
    act(() => rerender(undefined));
    mockStatus = settled('timed out');
    act(() => rerender(undefined));

    act(() => foregroundCallback?.());

    expect(syncNow).toHaveBeenCalledTimes(2);
  });

  it('re-syncs once per foreground return after a successful sync', () => {
    const syncNow = jest.fn().mockReturnValue(StartOutcome.Started);
    mockGetEngine.mockReturnValue(engineWith(syncNow));

    const { rerender } = renderHook(() => useEngineSync());
    mockStatus = {
      state: SyncState.Syncing,
      inFlight: 1,
      completed: 0,
      total: 1,
      stepItemsDone: 0,
      stepItemsTotal: 0,
    };
    act(() => rerender(undefined));
    mockStatus = settled();
    act(() => rerender(undefined));

    act(() => foregroundCallback?.());
    act(() => foregroundCallback?.());

    expect(syncNow).toHaveBeenCalledTimes(3);
  });

  it('announces the settled edge when a sync leaves the exclusive slot', () => {
    // A window refused while the launch sync held the slot has nothing else to
    // tell it the slot is free again.
    const syncNow = jest.fn().mockReturnValue(StartOutcome.Started);
    mockGetEngine.mockReturnValue(engineWith(syncNow));
    const settledListener = jest.fn();
    renderHook(() => useSyncSettled(settledListener));

    const { rerender } = renderHook(() => useEngineSync());
    mockStatus = {
      state: SyncState.Syncing,
      inFlight: 1,
      completed: 0,
      total: 1,
      stepItemsDone: 0,
      stepItemsTotal: 0,
    };
    act(() => rerender(undefined));
    expect(settledListener).not.toHaveBeenCalled();

    mockStatus = settled();
    act(() => rerender(undefined));

    expect(settledListener).toHaveBeenCalledTimes(1);
  });

  it('announces the settled edge for a sync that failed, which frees the slot too', () => {
    const syncNow = jest.fn().mockReturnValue(StartOutcome.Started);
    mockGetEngine.mockReturnValue(engineWith(syncNow));
    const settledListener = jest.fn();
    renderHook(() => useSyncSettled(settledListener));

    const { rerender } = renderHook(() => useEngineSync());
    mockStatus = {
      state: SyncState.Syncing,
      inFlight: 1,
      completed: 0,
      total: 1,
      stepItemsDone: 0,
      stepItemsTotal: 0,
    };
    act(() => rerender(undefined));
    mockStatus = settled('timed out');
    act(() => rerender(undefined));

    expect(settledListener).toHaveBeenCalledTimes(1);
  });

  it('does not retry an expired credential, which no amount of network fixes', () => {
    const syncNow = jest.fn().mockReturnValue(StartOutcome.Started);
    mockGetEngine.mockReturnValue(engineWith(syncNow));

    const { rerender } = renderHook(() => useEngineSync());
    mockStatus = {
      state: SyncState.Syncing,
      inFlight: 1,
      completed: 0,
      total: 1,
      stepItemsDone: 0,
      stepItemsTotal: 0,
    };
    act(() => rerender(undefined));
    mockStatus = {
      state: SyncState.AuthExpired,
      inFlight: 0,
      completed: 0,
      total: 0,
      stepItemsDone: 0,
      stepItemsTotal: 0,
      lastError: '401',
    };
    act(() => rerender(undefined));

    act(() => foregroundCallback?.());

    expect(syncNow).toHaveBeenCalledTimes(1);
  });
  it('refreshes the widget when a sync settles, not while it runs', () => {
    // The widget only had two writers, backgrounding and the silent-push task,
    // so a foreground sync left yesterday's numbers on the home screen until
    // the app was backgrounded.
    const syncNow = jest.fn().mockReturnValue(StartOutcome.Started);
    mockGetEngine.mockReturnValue(engineWith(syncNow));

    const { rerender } = renderHook(() => useEngineSync());
    mockStatus = {
      state: SyncState.Syncing,
      inFlight: 1,
      completed: 0,
      total: 1,
      stepItemsDone: 0,
      stepItemsTotal: 0,
    };
    act(() => rerender(undefined));
    expect(mockUpdateWidgetSnapshot).not.toHaveBeenCalled();

    mockStatus = settled();
    act(() => rerender(undefined));

    expect(mockUpdateWidgetSnapshot).toHaveBeenCalledTimes(1);
  });

  it('refreshes the widget after a sync that settled with an error', () => {
    // A sync that failed part-way still wrote the activities it did fetch, so
    // the widget is stale rather than correct if the error skips it.
    const syncNow = jest.fn().mockReturnValue(StartOutcome.Started);
    mockGetEngine.mockReturnValue(engineWith(syncNow));

    const { rerender } = renderHook(() => useEngineSync());
    mockStatus = {
      state: SyncState.Syncing,
      inFlight: 1,
      completed: 3,
      total: 9,
      stepItemsDone: 0,
      stepItemsTotal: 0,
    };
    act(() => rerender(undefined));
    mockStatus = settled('connection reset');
    act(() => rerender(undefined));

    expect(mockUpdateWidgetSnapshot).toHaveBeenCalledTimes(1);
  });

  it('leaves the widget alone when no sync ever ran', () => {
    const syncNow = jest.fn().mockReturnValue(StartOutcome.Started);
    mockGetEngine.mockReturnValue(engineWith(syncNow));

    const { rerender } = renderHook(() => useEngineSync());
    mockStatus = settled();
    act(() => rerender(undefined));

    expect(mockUpdateWidgetSnapshot).not.toHaveBeenCalled();
  });

  it('refreshes the widget once per sync, not once per settled render', () => {
    const syncNow = jest.fn().mockReturnValue(StartOutcome.Started);
    mockGetEngine.mockReturnValue(engineWith(syncNow));

    const { rerender } = renderHook(() => useEngineSync());
    mockStatus = {
      state: SyncState.Syncing,
      inFlight: 1,
      completed: 0,
      total: 1,
      stepItemsDone: 0,
      stepItemsTotal: 0,
    };
    act(() => rerender(undefined));
    mockStatus = settled();
    act(() => rerender(undefined));
    act(() => rerender(undefined));

    expect(mockUpdateWidgetSnapshot).toHaveBeenCalledTimes(1);
  });

  /**
   * Scenario: a pull to refresh is refused while a sync runs and held for the
   * next settle. The athlete then signs out, or clears the library, and the
   * hold outlives the account it was made for.
   */
  it('drops a held refresh on sign-out', () => {
    const syncNow = jest.fn().mockReturnValue(StartOutcome.Started);
    mockGetEngine.mockReturnValue(engineWith(syncNow));

    const { rerender } = renderHook(() => useEngineSync());
    expect(mockCancelSyncRefresh).not.toHaveBeenCalled();

    act(() => useAuthStore.setState({ isAuthenticated: false }));
    rerender(undefined);

    expect(mockCancelSyncRefresh).toHaveBeenCalledTimes(1);
  });

  it('drops a held refresh when the library is cleared', () => {
    const syncNow = jest.fn().mockReturnValue(StartOutcome.Started);
    mockGetEngine.mockReturnValue(engineWith(syncNow));

    renderHook(() => useEngineSync());

    act(() => resetListeners.forEach((fire) => fire()));

    expect(mockCancelSyncRefresh).toHaveBeenCalledTimes(1);
  });

  /**
   * Scenario: the athlete logs out and back in as someone else while a sync is
   * in flight. `clear_credentials` only soft-cancels, so the old sync still
   * holds the exclusive slot and the new athlete's first `syncNow` is refused.
   *
   * Expected behaviour: the refused start is asked again when the slot frees,
   * rather than waiting for a backgrounding or a network change.
   */
  it('starts again when a sync that refused the start settles', () => {
    const syncNow = jest
      .fn()
      .mockReturnValueOnce(StartOutcome.Busy)
      .mockReturnValue(StartOutcome.Started);
    mockGetEngine.mockReturnValue(engineWith(syncNow));

    const { rerender } = renderHook(() => useEngineSync());
    expect(syncNow).toHaveBeenCalledTimes(1);

    mockStatus = {
      state: SyncState.Syncing,
      inFlight: 1,
      completed: 0,
      total: 1,
      stepItemsDone: 0,
      stepItemsTotal: 0,
    };
    act(() => rerender(undefined));
    mockStatus = settled();
    act(() => rerender(undefined));

    expect(syncNow).toHaveBeenCalledTimes(2);
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
  it('wakes the activity readers when a sync step lands its rows', () => {
    const engine = engineWith(jest.fn().mockReturnValue(StartOutcome.Started));
    mockGetEngine.mockReturnValue(engine);

    renderHook(() => useEngineSync());
    expect(engine?.triggerRefresh).not.toHaveBeenCalled();

    act(() => storedListeners.forEach((listener) => listener()));

    expect(engine?.triggerRefresh).toHaveBeenCalledWith('activities');
  });

  it('leaves a sync that settled with an error to the reconnect, not an immediate retry', () => {
    // The credential may be the thing that failed, and asking again straight
    // away hammers a 401 on every settle.
    const syncNow = jest.fn().mockReturnValue(StartOutcome.Started);
    mockGetEngine.mockReturnValue(engineWith(syncNow));

    const { rerender } = renderHook(() => useEngineSync());
    mockStatus = {
      state: SyncState.Syncing,
      inFlight: 1,
      completed: 0,
      total: 1,
      stepItemsDone: 0,
      stepItemsTotal: 0,
    };
    act(() => rerender(undefined));
    mockStatus = settled('connection reset');
    act(() => rerender(undefined));

    expect(syncNow).toHaveBeenCalledTimes(1);
  });
});
