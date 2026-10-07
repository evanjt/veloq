import { act, renderHook } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';

import { OAUTH } from '@/features/auth/constants';
import { useOAuthLogin } from '@/features/auth/hooks/useOAuthLogin';
import { handleOAuthCallback } from '@/features/auth/lib/oauth';
import { useCanRecord } from '@/features/recording/hooks/useCanRecord';
import { usePermissionUpgrade } from '@/features/recording/hooks/usePermissionUpgrade';
import { useUploadPermissionStore } from '@/features/recording/stores/UploadPermissionStore';
import { useAuthStore } from '@/shared/app/AuthStore';
import { clearPermissionBlocked } from '@/features/recording/lib/storage/recordingLibrary';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').fallbackOrKey());
jest.mock('expo-web-browser', () => ({
  ...jest.requireActual('expo-web-browser'),
  openAuthSessionAsync: jest.fn(),
}));
jest.mock('expo-crypto', () => ({
  ...jest.requireActual('expo-crypto'),
  getRandomBytes: (length: number) => new Uint8Array(length),
  digestStringAsync: jest.fn().mockResolvedValue('fake-challenge'),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  CryptoEncoding: { BASE64: 'base64' },
}));
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({}),
}));
jest.mock('@/shared/app/navigation', () => ({ replaceTo: jest.fn() }));
jest.mock('@/shared/app/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: true }),
  useIsOnline: () => true,
}));
jest.mock('@/shared/app/SyncDateRangeStore', () => ({
  useSyncDateRange: () => jest.fn(),
}));
jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn().mockResolvedValue(null),
  setSetting: jest.fn().mockResolvedValue(undefined),
  removeSetting: jest.fn().mockResolvedValue(undefined),
  clearAccountData: jest.fn().mockResolvedValue(undefined),
  clearAuthOnly: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/auth/lib/accountChange', () => ({
  getCachedAthleteId: jest.fn().mockResolvedValue(null),
  accountChangeAction: jest.fn().mockReturnValue('wipe'),
}));
jest.mock('@/features/auth/lib/storedActivityCount', () => ({
  resolveStoredActivityCount: jest.fn(async () => 0),
}));
jest.mock('@/features/auth/lib/oauth', () => ({
  ...jest.requireActual('@/features/auth/lib/oauth'),
  handleOAuthCallback: jest.fn(),
}));
jest.mock('@/features/auth', () => ({
  ...jest.requireActual('@/features/auth/lib/oauth'),
  handleOAuthCallback: require('@/features/auth/lib/oauth').handleOAuthCallback,
  OAUTH: require('@/features/auth/constants').OAUTH,
}));
jest.mock('@/features/recording/lib/storage/recordingLibrary', () => ({
  clearPermissionBlocked: jest.fn().mockResolvedValue(undefined),
}));

const mockBrowser = jest.mocked(WebBrowser.openAuthSessionAsync);
const mockCallback = jest.mocked(handleOAuthCallback);
const originalFetch = global.fetch;
const setError = jest.fn();

function token(scope?: string) {
  return {
    access_token: 'fake-access-token',
    token_type: 'Bearer',
    athlete_id: '123',
    athlete_name: 'Test athlete',
    ...(scope === undefined ? {} : { scope }),
  };
}

function requestedScopes() {
  const url = mockBrowser.mock.calls[0][0];
  return new URL(url).searchParams.get('scope')?.split(',');
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn().mockResolvedValue({ ok: true });
  useAuthStore.setState({
    authMethod: 'oauth',
    setOAuthCredentials: jest.fn().mockResolvedValue(undefined),
  });
  useUploadPermissionStore.getState().reset();
  mockBrowser.mockResolvedValue({ type: 'success', url: 'veloq://oauth/callback?code=fake' });
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('OAuth sign-in permission answer', () => {
  it.each([
    ['', 'no_permission', false],
    [undefined, 'no_permission', false],
    ['ACTIVITY:READ', 'no_permission', false],
    ['ACTIVITY:WRITE', 'ok', true],
  ] as const)(
    'resolves a reset permission store for scope %s',
    async (scope, reason, canRecord) => {
      mockCallback.mockResolvedValue(
        token(scope) as Awaited<ReturnType<typeof handleOAuthCallback>>
      );
      const { result } = renderHook(() => ({
        login: useOAuthLogin({ setError }),
        recording: useCanRecord(),
      }));
      expect(result.current.recording.reason).toBe('checking');

      await act(() => result.current.login.handleOAuthLogin());

      expect(useUploadPermissionStore.getState().isLoaded).toBe(true);
      expect(result.current.recording).toEqual({ canRecord, reason });
      expect(setError).toHaveBeenLastCalledWith(null);
    }
  );

  it('replaces write permission after a sign-out and a second sign-in with no scope', async () => {
    mockCallback
      .mockResolvedValueOnce(
        token('ACTIVITY:WRITE') as Awaited<ReturnType<typeof handleOAuthCallback>>
      )
      .mockResolvedValueOnce(token('') as Awaited<ReturnType<typeof handleOAuthCallback>>);
    const { result } = renderHook(() => ({
      login: useOAuthLogin({ setError }),
      recording: useCanRecord(),
    }));
    await act(() => result.current.login.handleOAuthLogin());
    expect(result.current.recording.reason).toBe('ok');
    act(() => useUploadPermissionStore.getState().reset());
    await act(() => result.current.login.handleOAuthLogin());
    expect(result.current.recording.reason).toBe('no_permission');
    expect(useUploadPermissionStore.getState().isLoaded).toBe(true);
  });

  it.each(['cancel', 'failure'] as const)('keeps permission unknown after %s', async (outcome) => {
    if (outcome === 'cancel')
      mockBrowser.mockResolvedValue({ type: WebBrowser.WebBrowserResultType.CANCEL });
    else mockCallback.mockRejectedValue(new Error('Token exchange failed'));
    const { result } = renderHook(() => useOAuthLogin({ setError }));
    await act(() => result.current.handleOAuthLogin());
    expect(useUploadPermissionStore.getState().isLoaded).toBe(false);
    expect(useUploadPermissionStore.getState().hasWritePermission).toBeNull();
  });
});

describe('OAuth write scope boundary', () => {
  it('keeps the existing athlete when another athlete grants write access', async () => {
    useAuthStore.setState({ athleteId: 'athlete-a' });
    useUploadPermissionStore.getState().setFromOAuthScope('ACTIVITY:READ');
    mockCallback.mockResolvedValue(
      token('ACTIVITY:WRITE') as Awaited<ReturnType<typeof handleOAuthCallback>>
    );
    const { result } = renderHook(() => usePermissionUpgrade());
    await act(async () => {
      expect(await result.current.upgradePermissions()).toBe(false);
    });
    expect(useAuthStore.getState().setOAuthCredentials).not.toHaveBeenCalled();
    expect(useUploadPermissionStore.getState().grantedScopes).toBe('ACTIVITY:READ');
    expect(clearPermissionBlocked).not.toHaveBeenCalled();
    expect(result.current.error).toContain('123');
  });
  it("requeues only the upgrading athlete's blocked rides", async () => {
    useAuthStore.setState({ athleteId: '123' });
    mockCallback.mockResolvedValue(
      token('ACTIVITY:WRITE') as Awaited<ReturnType<typeof handleOAuthCallback>>
    );
    const { result } = renderHook(() => usePermissionUpgrade());
    await act(async () => {
      expect(await result.current.upgradePermissions()).toBe(true);
    });
    expect(clearPermissionBlocked).toHaveBeenCalledTimes(1);
    expect(clearPermissionBlocked).toHaveBeenCalledWith('123');
  });

  it('reserves write access for the explicit upgrade', () => {
    expect(OAUTH.SCOPES.filter((scope) => scope.endsWith(':WRITE'))).toEqual([]);
    expect(OAUTH.UPGRADE_SCOPES).toContain('ACTIVITY:WRITE');
  });

  it('opens sign-in with a read-only authorisation URL', async () => {
    mockBrowser.mockResolvedValue({ type: WebBrowser.WebBrowserResultType.CANCEL });
    const { result } = renderHook(() => useOAuthLogin({ setError }));
    await act(() => result.current.handleOAuthLogin());
    expect(mockBrowser).toHaveBeenCalledTimes(1);
    expect(requestedScopes()).not.toContain('ACTIVITY:WRITE');
    expect(requestedScopes()?.filter((scope) => scope.endsWith(':WRITE'))).toEqual([]);
  });

  it('opens the explicit permission upgrade with activity write access', async () => {
    mockBrowser.mockResolvedValue({ type: WebBrowser.WebBrowserResultType.CANCEL });
    const { result } = renderHook(() => usePermissionUpgrade());
    await act(async () => {
      await result.current.upgradePermissions();
    });
    expect(mockBrowser).toHaveBeenCalledTimes(1);
    expect(requestedScopes()).toContain('ACTIVITY:WRITE');
  });
});
