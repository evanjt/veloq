/**
 * Scenario: the Rust transport classifies a 401 and parks the sync service in
 * `authExpired`. Nothing else observes that state, so this hook is the only
 * path from a rejected token to the re-login prompt.
 */

import { renderHook } from '@testing-library/react-native';

import { useAuthStore } from '@/shared/app/AuthStore';
import { useSyncAuthExpiry } from '@/shared/native/useSyncAuthExpiry';
import { useSyncStatus } from '@/shared/native/useSyncStatus';
import type { SyncStatus } from 'veloqrs';

jest.mock('@/shared/native/useSyncStatus', () => ({
  useSyncStatus: jest.fn(),
}));

const mockUseSyncStatus = useSyncStatus as jest.MockedFunction<typeof useSyncStatus>;

function status(state: SyncStatus['state']): SyncStatus {
  return { state, inFlight: 0, completed: 0, total: 0 };
}

describe('useSyncAuthExpiry', () => {
  let handleSessionExpired: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    handleSessionExpired = jest.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ handleSessionExpired });
  });

  it('leaves a healthy session alone', () => {
    mockUseSyncStatus.mockReturnValue(status('idle'));

    renderHook(() => useSyncAuthExpiry());

    expect(handleSessionExpired).not.toHaveBeenCalled();
  });

  it('tears down the session when the service reports authExpired', () => {
    mockUseSyncStatus.mockReturnValue(status('authExpired'));

    renderHook(() => useSyncAuthExpiry());

    expect(handleSessionExpired).toHaveBeenCalledWith('signed_out');
  });

  it('tears down once while the state stays authExpired', () => {
    mockUseSyncStatus.mockReturnValue(status('authExpired'));

    const { rerender } = renderHook(() => useSyncAuthExpiry());
    rerender({});
    rerender({});

    expect(handleSessionExpired).toHaveBeenCalledTimes(1);
  });

  it('arms again after the service recovers', () => {
    mockUseSyncStatus.mockReturnValue(status('authExpired'));
    const { rerender } = renderHook(() => useSyncAuthExpiry());

    mockUseSyncStatus.mockReturnValue(status('syncing'));
    rerender({});
    mockUseSyncStatus.mockReturnValue(status('authExpired'));
    rerender({});

    expect(handleSessionExpired).toHaveBeenCalledTimes(2);
  });
});
