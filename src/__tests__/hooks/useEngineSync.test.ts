/**
 * Scenario: the launch sync mounts before the root layout opens the engine, so
 * the first `syncNow` reaches a null handle and never touches Rust.
 *
 * Expected behaviour: the latch holds only when the call actually started a
 * sync, and the engine-ready bump brings the effect back to retry.
 */

import { act, renderHook } from '@testing-library/react-native';

import { useEngineStatus } from '@/features/routes/stores/EngineStatusStore';
import { useAuthStore } from '@/shared/app/AuthStore';
import { getRouteEngine } from '@/shared/native/routeEngine';
import { useEngineSync } from '@/shared/native/useEngineSync';

jest.mock('@/shared/native/routeEngine', () => ({
  getRouteEngine: jest.fn(),
}));

jest.mock('@/shared/native/useSyncStatus', () => ({
  useSyncStatus: () => null,
}));

const mockGetRouteEngine = getRouteEngine as jest.MockedFunction<typeof getRouteEngine>;

function engineWith(syncNow: jest.Mock) {
  return { syncNow, triggerRefresh: jest.fn() } as unknown as ReturnType<typeof getRouteEngine>;
}

describe('useEngineSync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
});
