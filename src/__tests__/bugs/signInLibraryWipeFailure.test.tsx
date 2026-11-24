/**
 * Scenario: the athlete signs in as a different account, so the library on the
 * device has to be wiped first, and the wipe is refused because the database
 * is busy.
 *
 * Expected behaviour: every sign-in path says the library could not be cleared,
 * with the engine's own line for the failure. A connection or OAuth failure
 * message would send the athlete to retry the network.
 */
import { act, renderHook } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';
import { FfiCallKind, GarminKeyStatus, validateCredentials, checkGarminKey } from 'veloqrs';

import { useApiKeyLogin } from '@/features/auth/hooks/useApiKeyLogin';
import { useGarminLogin } from '@/features/auth/hooks/useGarminLogin';
import { useOAuthLogin } from '@/features/auth/hooks/useOAuthLogin';
import { handleOAuthCallback } from '@/features/auth/lib/oauth';
import { clearAccountData } from '@/shared/storage';
import { useAuthStore } from '@/shared/app/AuthStore';

jest.mock('veloqrs', () => ({
  ...require('../__shared__/veloqrsStub').withOverrides(),
  validateCredentials: jest.fn(),
  checkGarminKey: jest.fn(),
}));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
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
  clearAccountData: jest.fn(),
  clearAuthOnly: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/auth/lib/accountChange', () => ({
  getCachedAthleteId: jest.fn().mockResolvedValue('i-first'),
  accountChangeAction: jest.fn().mockReturnValue('wipe'),
  confirmAccountChange: jest.fn().mockResolvedValue(true),
  settleBeforeNamingLibrary: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/auth/lib/storedActivityCount', () => ({
  resolveStoredActivityCount: jest.fn(async () => 0),
}));
jest.mock('@/features/auth/lib/oauth', () => ({
  ...jest.requireActual('@/features/auth/lib/oauth'),
  isOAuthConfigured: () => true,
  handleOAuthCallback: jest.fn(),
}));
jest.mock('@/features/auth/lib/pendingSignIn', () => ({
  ...jest.requireActual('@/features/auth/lib/pendingSignIn'),
  readPendingApiKey: jest.fn(async () => null),
  clearPendingApiKey: jest.fn(async () => undefined),
}));

const originalFetch = global.fetch;
afterAll(() => {
  global.fetch = originalFetch;
});

const busy = Object.assign(new Error('busy'), { tag: 'Busy' });

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn().mockResolvedValue({ ok: true });
  jest.mocked(clearAccountData).mockRejectedValue(busy);
  useAuthStore.setState({
    setCredentials: jest.fn().mockResolvedValue(undefined),
    setOAuthCredentials: jest.fn().mockResolvedValue(undefined),
    setGarminCredentials: jest.fn().mockResolvedValue(undefined),
  } as never);
});

it('API key sign-in names the failed wipe, not a connection failure', async () => {
  jest
    .mocked(validateCredentials)
    .mockResolvedValue({ kind: FfiCallKind.Ok, id: 'i-second' } as never);
  const setError = jest.fn();
  const { result } = await renderHook(() => useApiKeyLogin({ setError }));

  await act(() => result.current.handleApiKeyLogin('a-valid-key'));

  expect(setError).toHaveBeenLastCalledWith('engine.failure.busy');
  expect(useAuthStore.getState().setCredentials).not.toHaveBeenCalled();
});

it('API key sign-in names a wipe failure that is not an engine error as failedToClear', async () => {
  jest
    .mocked(validateCredentials)
    .mockResolvedValue({ kind: FfiCallKind.Ok, id: 'i-second' } as never);
  jest.mocked(clearAccountData).mockRejectedValue(new Error('disk'));
  const setError = jest.fn();
  const { result } = await renderHook(() => useApiKeyLogin({ setError }));

  await act(() => result.current.handleApiKeyLogin('a-valid-key'));

  expect(setError).toHaveBeenLastCalledWith('alerts.failedToClear');
});

it('API key sign-in still reports an unreachable server as a connection failure', async () => {
  jest.mocked(validateCredentials).mockRejectedValue(new Error('offline'));
  const setError = jest.fn();
  const { result } = await renderHook(() => useApiKeyLogin({ setError }));

  await act(() => result.current.handleApiKeyLogin('a-valid-key'));

  expect(setError).toHaveBeenLastCalledWith('login.connectionFailed');
});

it('OAuth sign-in names the failed wipe, not an OAuth failure', async () => {
  jest.mocked(WebBrowser.openAuthSessionAsync).mockResolvedValue({
    type: 'success',
    url: 'veloq://oauth/callback?code=fake',
  });
  jest.mocked(handleOAuthCallback).mockResolvedValue({
    access_token: 'token',
    token_type: 'Bearer',
    athlete_id: 'i-second',
  } as Awaited<ReturnType<typeof handleOAuthCallback>>);
  const setError = jest.fn();
  const { result } = await renderHook(() => useOAuthLogin({ setError }));

  await act(() => result.current.handleOAuthLogin());

  expect(setError).toHaveBeenLastCalledWith('engine.failure.busy');
  expect(useAuthStore.getState().setOAuthCredentials).not.toHaveBeenCalled();
});

it('Garmin sign-in names the failed wipe, not an unreachable key check', async () => {
  jest.mocked(checkGarminKey).mockResolvedValue({
    status: GarminKeyStatus.Connected,
    accountId: 'g-2',
  } as never);
  const setError = jest.fn();
  const { result } = await renderHook(() => useGarminLogin({ setError }));

  await act(() => result.current.handleGarminLogin('a-garmin-key'));

  expect(setError).toHaveBeenLastCalledWith('engine.failure.busy');
  expect(useAuthStore.getState().setGarminCredentials).not.toHaveBeenCalled();
});
