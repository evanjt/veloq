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
import { getRouteEngine } from '@/shared/native/routeEngine';
import { useEngineSync } from '@/shared/native/useEngineSync';
import { useSyncSettled } from '@/shared/app/useRetryTriggers';
import { updateWidgetSnapshot } from '@/features/home/lib/widgetBridge';
import type { SyncStatus } from 'veloqrs';

jest.mock('@/shared/native/routeEngine', () => ({
  getRouteEngine: jest.fn(),
}));

let mockStatus: SyncStatus | null = null;
jest.mock('@/shared/native/useSyncStatus', () => ({
  useSyncStatus: () => mockStatus,
}));

let mockIsOnline = true;
jest.mock('@/shared/app/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: mockIsOnline, isInternetReachable: null, connectionType: null }),
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

const mockGetRouteEngine = getRouteEngine as jest.MockedFunction<typeof getRouteEngine>;
const mockUpdateWidgetSnapshot = updateWidgetSnapshot as jest.MockedFunction<
  typeof updateWidgetSnapshot
>;

function engineWith(syncNow: jest.Mock) {
  return { syncNow, triggerRefresh: jest.fn() } as unknown as ReturnType<typeof getRouteEngine>;
}

function settled(lastError?: string): SyncStatus {
  return { state: 'idle', inFlight: 0, completed: 0, total: 0, lastError };
}

describe('useEngineSync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStatus = null;
    mockIsOnline = true;
    foregroundCallback = null;
    useEngineStatus.setState({ readyNonce: 0 });
    useAuthStore.setState({ isAuthenticated: true, isDemoMode: false });
  });

  it('retries once the engine is ready when the first call found none', () => {
    const syncNow = jest.fn().mockReturnValueOnce(false).mockReturnValue(true);
    mockGetRouteEngine.mockReturnValue(engineWith(syncNow));

    renderHook(() => useEngineSync());
    expect(syncNow).toHaveBeenCalledTimes(1);

    act(() => useEngineStatus.getState().markEngineReady());
    expect(syncNow).toHaveBeenCalledTimes(2);

    act(() => useEngineStatus.getState().markEngineReady());
    expect(syncNow).toHaveBeenCalledTimes(2);
  });

  it('starts once when the engine is already up', () => {
    const syncNow = jest.fn().mockReturnValue(true);
    mockGetRouteEngine.mockReturnValue(engineWith(syncNow));

    renderHook(() => useEngineSync());
    act(() => useEngineStatus.getState().markEngineReady());

    expect(syncNow).toHaveBeenCalledTimes(1);
  });

  it('skips demo mode, which reads seeded rows', () => {
    const syncNow = jest.fn().mockReturnValue(true);
    mockGetRouteEngine.mockReturnValue(engineWith(syncNow));
    useAuthStore.setState({ isDemoMode: true });

    renderHook(() => useEngineSync());

    expect(syncNow).not.toHaveBeenCalled();
  });

  it('retries on reconnect after a sync settled with an error', () => {
    const syncNow = jest.fn().mockReturnValue(true);
    mockGetRouteEngine.mockReturnValue(engineWith(syncNow));

    const { rerender } = renderHook(() => useEngineSync());
    expect(syncNow).toHaveBeenCalledTimes(1);

    mockStatus = { state: 'syncing', inFlight: 1, completed: 0, total: 1 };
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
    const syncNow = jest.fn().mockReturnValue(true);
    mockGetRouteEngine.mockReturnValue(engineWith(syncNow));

    const { rerender } = renderHook(() => useEngineSync());
    mockStatus = { state: 'syncing', inFlight: 1, completed: 0, total: 1 };
    act(() => rerender(undefined));
    mockStatus = settled('timed out');
    act(() => rerender(undefined));

    act(() => foregroundCallback?.());

    expect(syncNow).toHaveBeenCalledTimes(2);
  });

  it('does not re-sync on foreground when the sync succeeded', () => {
    const syncNow = jest.fn().mockReturnValue(true);
    mockGetRouteEngine.mockReturnValue(engineWith(syncNow));

    const { rerender } = renderHook(() => useEngineSync());
    mockStatus = { state: 'syncing', inFlight: 1, completed: 0, total: 1 };
    act(() => rerender(undefined));
    mockStatus = settled();
    act(() => rerender(undefined));

    act(() => foregroundCallback?.());
    act(() => foregroundCallback?.());

    expect(syncNow).toHaveBeenCalledTimes(1);
  });

  it('announces the settled edge when a sync leaves the exclusive slot', () => {
    // A window refused while the launch sync held the slot has nothing else to
    // tell it the slot is free again.
    const syncNow = jest.fn().mockReturnValue(true);
    mockGetRouteEngine.mockReturnValue(engineWith(syncNow));
    const settledListener = jest.fn();
    renderHook(() => useSyncSettled(settledListener));

    const { rerender } = renderHook(() => useEngineSync());
    mockStatus = { state: 'syncing', inFlight: 1, completed: 0, total: 1 };
    act(() => rerender(undefined));
    expect(settledListener).not.toHaveBeenCalled();

    mockStatus = settled();
    act(() => rerender(undefined));

    expect(settledListener).toHaveBeenCalledTimes(1);
  });

  it('announces the settled edge for a sync that failed, which frees the slot too', () => {
    const syncNow = jest.fn().mockReturnValue(true);
    mockGetRouteEngine.mockReturnValue(engineWith(syncNow));
    const settledListener = jest.fn();
    renderHook(() => useSyncSettled(settledListener));

    const { rerender } = renderHook(() => useEngineSync());
    mockStatus = { state: 'syncing', inFlight: 1, completed: 0, total: 1 };
    act(() => rerender(undefined));
    mockStatus = settled('timed out');
    act(() => rerender(undefined));

    expect(settledListener).toHaveBeenCalledTimes(1);
  });

  it('does not retry an expired credential, which no amount of network fixes', () => {
    const syncNow = jest.fn().mockReturnValue(true);
    mockGetRouteEngine.mockReturnValue(engineWith(syncNow));

    const { rerender } = renderHook(() => useEngineSync());
    mockStatus = { state: 'syncing', inFlight: 1, completed: 0, total: 1 };
    act(() => rerender(undefined));
    mockStatus = { state: 'authExpired', inFlight: 0, completed: 0, total: 0, lastError: '401' };
    act(() => rerender(undefined));

    act(() => foregroundCallback?.());

    expect(syncNow).toHaveBeenCalledTimes(1);
  });
  it('refreshes the widget when a sync settles, not while it runs', () => {
    // The widget only had two writers, backgrounding and the silent-push task,
    // so a foreground sync left yesterday's numbers on the home screen until
    // the app was backgrounded.
    const syncNow = jest.fn().mockReturnValue(true);
    mockGetRouteEngine.mockReturnValue(engineWith(syncNow));

    const { rerender } = renderHook(() => useEngineSync());
    mockStatus = { state: 'syncing', inFlight: 1, completed: 0, total: 1 };
    act(() => rerender(undefined));
    expect(mockUpdateWidgetSnapshot).not.toHaveBeenCalled();

    mockStatus = settled();
    act(() => rerender(undefined));

    expect(mockUpdateWidgetSnapshot).toHaveBeenCalledTimes(1);
  });

  it('refreshes the widget after a sync that settled with an error', () => {
    // A sync that failed part-way still wrote the activities it did fetch, so
    // the widget is stale rather than correct if the error skips it.
    const syncNow = jest.fn().mockReturnValue(true);
    mockGetRouteEngine.mockReturnValue(engineWith(syncNow));

    const { rerender } = renderHook(() => useEngineSync());
    mockStatus = { state: 'syncing', inFlight: 1, completed: 3, total: 9 };
    act(() => rerender(undefined));
    mockStatus = settled('connection reset');
    act(() => rerender(undefined));

    expect(mockUpdateWidgetSnapshot).toHaveBeenCalledTimes(1);
  });

  it('leaves the widget alone when no sync ever ran', () => {
    const syncNow = jest.fn().mockReturnValue(true);
    mockGetRouteEngine.mockReturnValue(engineWith(syncNow));

    const { rerender } = renderHook(() => useEngineSync());
    mockStatus = settled();
    act(() => rerender(undefined));

    expect(mockUpdateWidgetSnapshot).not.toHaveBeenCalled();
  });

  it('refreshes the widget once per sync, not once per settled render', () => {
    const syncNow = jest.fn().mockReturnValue(true);
    mockGetRouteEngine.mockReturnValue(engineWith(syncNow));

    const { rerender } = renderHook(() => useEngineSync());
    mockStatus = { state: 'syncing', inFlight: 1, completed: 0, total: 1 };
    act(() => rerender(undefined));
    mockStatus = settled();
    act(() => rerender(undefined));
    act(() => rerender(undefined));

    expect(mockUpdateWidgetSnapshot).toHaveBeenCalledTimes(1);
  });
});
