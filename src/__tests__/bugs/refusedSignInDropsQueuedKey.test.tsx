/**
 * Scenario: a key typed offline is still queued when the athlete tries OAuth
 * as another account instead, and cancels the wipe prompt.
 *
 * Expected behaviour: the refusal drops the queued key, as the API-key path's
 * own refusal does, so the next reconnect has nothing to sign its owner in with.
 */
import { act, renderHook } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';

import { useOAuthLogin } from '@/features/auth/hooks/useOAuthLogin';
import { handleOAuthCallback } from '@/features/auth/lib/oauth';
import { clearAccountData, clearAuthOnly } from '@/shared/storage';
import { useAuthStore } from '@/shared/app/AuthStore';

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
  getCachedAthleteId: jest.fn().mockResolvedValue('i-first'),
  accountChangeAction: jest.fn().mockReturnValue('confirm-then-wipe'),
  confirmAccountChange: jest.fn().mockResolvedValue(false),
}));
jest.mock('@/features/auth/lib/storedActivityCount', () => ({
  resolveStoredActivityCount: jest.fn(async () => 0),
}));
jest.mock('@/features/auth/lib/oauth', () => ({
  ...jest.requireActual('@/features/auth/lib/oauth'),
  isOAuthConfigured: () => true,
  handleOAuthCallback: jest.fn(),
}));

const originalFetch = global.fetch;
const held: { key: string | null } = { key: null };
jest.mock('@/features/auth/lib/pendingSignIn', () => ({
  ...jest.requireActual('@/features/auth/lib/pendingSignIn'),
  readPendingApiKey: jest.fn(async () => held.key),
  clearPendingApiKey: jest.fn(async () => {
    held.key = null;
  }),
}));

afterAll(() => {
  global.fetch = originalFetch;
});

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn().mockResolvedValue({ ok: true });
  held.key = 'queued-key';
  useAuthStore.setState({ setOAuthCredentials: jest.fn().mockResolvedValue(undefined) });
  jest.mocked(WebBrowser.openAuthSessionAsync).mockResolvedValue({
    type: 'success',
    url: 'veloq://oauth/callback?code=fake',
  });
  jest.mocked(handleOAuthCallback).mockResolvedValue({
    access_token: 'token',
    token_type: 'Bearer',
    athlete_id: 'i-second',
  } as Awaited<ReturnType<typeof handleOAuthCallback>>);
});

it('drops the queued key when the athlete refuses the account change', async () => {
  const { result } = renderHook(() => useOAuthLogin({ setError: jest.fn() }));

  await act(() => result.current.handleOAuthLogin());

  expect(held.key).toBeNull();
  expect(clearAccountData).not.toHaveBeenCalled();
  expect(clearAuthOnly).not.toHaveBeenCalled();
  expect(useAuthStore.getState().setOAuthCredentials).not.toHaveBeenCalled();
});

it('hands the refusal to the screen, so the queued banner goes with the key', async () => {
  const discardQueuedKey = jest.fn(async () => {
    held.key = null;
  });
  const { result } = renderHook(() => useOAuthLogin({ setError: jest.fn(), discardQueuedKey }));

  await act(() => result.current.handleOAuthLogin());

  expect(discardQueuedKey).toHaveBeenCalledTimes(1);
  expect(held.key).toBeNull();
});
