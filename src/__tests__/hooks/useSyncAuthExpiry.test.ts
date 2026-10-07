/**
 * Scenario: the Rust transport classifies a 401 and parks the sync service in
 * `authExpired`. Nothing else observes that state, so this hook is the only
 * path from a rejected token to the re-login prompt.
 */

import { renderHook } from '@testing-library/react-native';

import { useAuthStore } from '@/shared/app/AuthStore';
import { useSyncAuthExpiry } from '@/shared/native/useSyncAuthExpiry';
import { useSyncState } from '@/shared/native/useSyncStatus';
import { SyncState } from 'veloqrs';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/native/useSyncStatus', () => ({
  useSyncState: jest.fn(),
}));

const mockUseSyncState = useSyncState as jest.MockedFunction<typeof useSyncState>;

describe('useSyncAuthExpiry', () => {
  let handleSessionExpired: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    handleSessionExpired = jest.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ handleSessionExpired });
  });

  it('leaves a healthy session alone', () => {
    mockUseSyncState.mockReturnValue(SyncState.Idle);

    renderHook(() => useSyncAuthExpiry());

    expect(handleSessionExpired).not.toHaveBeenCalled();
  });

  it('tears down the session when the service reports authExpired', () => {
    mockUseSyncState.mockReturnValue(SyncState.AuthExpired);

    renderHook(() => useSyncAuthExpiry());

    expect(handleSessionExpired).toHaveBeenCalledTimes(1);
  });

  it('tears down once while the state stays authExpired', () => {
    mockUseSyncState.mockReturnValue(SyncState.AuthExpired);

    const { rerender } = renderHook(() => useSyncAuthExpiry());
    rerender({});
    rerender({});

    expect(handleSessionExpired).toHaveBeenCalledTimes(1);
  });

  it('arms again after the service recovers', () => {
    mockUseSyncState.mockReturnValue(SyncState.AuthExpired);
    const { rerender } = renderHook(() => useSyncAuthExpiry());

    mockUseSyncState.mockReturnValue(SyncState.Syncing);
    rerender({});
    mockUseSyncState.mockReturnValue(SyncState.AuthExpired);
    rerender({});

    expect(handleSessionExpired).toHaveBeenCalledTimes(2);
  });
});
