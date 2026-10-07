/**
 * Scenario: signed out, in aeroplane mode, with the app in German, the athlete
 * taps the intervals.icu sign-in button. The proxy registration is a fetch, and
 * its failure reached the error slot as the platform's English text: "Network
 * request failed", or "Request timed out after 10s" on a connection that takes
 * the handshake and answers nothing.
 *
 * Expected behaviour: offline, nothing is asked and the slot says sign-in needs
 * a network. A fetch that fails, one that times out and a proxy that refuses
 * each show a translated message, never the error's own text.
 */
import { act, renderHook } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';

import { useOAuthLogin } from '@/features/auth/hooks/useOAuthLogin';
import { NET_DEADLINE_MS } from '@/shared/net/fetchWithDeadline';

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
// The parse only has to read query parameters off the callback URL.
jest.mock('expo-linking', () => ({
  ...jest.requireActual('expo-linking'),
  parse: (url: string) => ({
    queryParams: Object.fromEntries(new URL(url).searchParams.entries()),
  }),
}));
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({}),
}));
jest.mock('@/shared/app/navigation', () => ({ replaceTo: jest.fn() }));
jest.mock('@/shared/app/SyncDateRangeStore', () => ({
  useSyncDateRange: () => jest.fn(),
}));
jest.mock('@/shared/storage', () => ({
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

const mockIsOnline = jest.fn(() => true);
jest.mock('@/shared/app/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: mockIsOnline() }),
  useIsOnline: () => mockIsOnline(),
}));

const mockBrowser = jest.mocked(WebBrowser.openAuthSessionAsync);
const originalFetch = global.fetch;
const setError = jest.fn();

function signIn() {
  const { result } = renderHook(() => useOAuthLogin({ setError }));
  return result.current.handleOAuthLogin;
}

/** The last message the error slot was handed. */
function shown(): string | null {
  const calls = setError.mock.calls;
  return calls.length === 0 ? null : calls[calls.length - 1][0];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIsOnline.mockReturnValue(true);
  global.fetch = jest.fn().mockResolvedValue({ ok: true });
  mockBrowser.mockResolvedValue({ type: 'cancel' } as WebBrowser.WebBrowserAuthSessionResult);
});

afterEach(() => {
  jest.useRealTimers();
});

afterAll(() => {
  global.fetch = originalFetch;
});

it('asks nothing offline and says sign-in needs a network', async () => {
  mockIsOnline.mockReturnValue(false);
  const handleOAuthLogin = signIn();

  await act(async () => {
    await handleOAuthLogin();
  });

  expect(global.fetch).not.toHaveBeenCalled();
  expect(mockBrowser).not.toHaveBeenCalled();
  expect(shown()).toBe('login.oauthNeedsNetwork');
});

it('shows translated text when the proxy fetch fails in transport', async () => {
  global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
  const handleOAuthLogin = signIn();

  await act(async () => {
    await handleOAuthLogin();
  });

  expect(shown()).toBe('login.oauthUnreachable');
  expect(mockBrowser).not.toHaveBeenCalled();
});

it('shows translated text when the proxy fetch runs out its deadline', async () => {
  jest.useFakeTimers();
  global.fetch = jest.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
      })
  ) as unknown as typeof fetch;
  const handleOAuthLogin = signIn();

  await act(async () => {
    const attempt = handleOAuthLogin();
    await jest.advanceTimersByTimeAsync(NET_DEADLINE_MS.interactive);
    await attempt;
  });

  expect(shown()).toBe('login.oauthUnreachable');
  expect(mockBrowser).not.toHaveBeenCalled();
});

it('shows translated text when the proxy refuses to register the state', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });
  const handleOAuthLogin = signIn();

  await act(async () => {
    await handleOAuthLogin();
  });

  expect(shown()).toBe('login.oauthProxyRefused');
  expect(mockBrowser).not.toHaveBeenCalled();
});

it('shows translated text when the proxy refuses to redeem the code', async () => {
  mockBrowser.mockImplementation(async () => ({
    type: 'success',
    url: `veloq://oauth/callback?success=true&code=fake&state=${lastState()}`,
  }));
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce({ ok: true })
    .mockResolvedValueOnce({ ok: false, status: 502 });
  const handleOAuthLogin = signIn();

  await act(async () => {
    await handleOAuthLogin();
  });

  expect(shown()).toBe('login.oauthProxyRefused');
});

it('does not name the API key for a failure with no message', async () => {
  global.fetch = jest.fn().mockRejectedValue('dropped');
  const handleOAuthLogin = signIn();

  await act(async () => {
    await handleOAuthLogin();
  });

  expect(shown()).toBe('login.oauthFailed');
});

it.each([
  ['access is denied', 'success=false&error=access_denied', 'login.oauthAccessDenied'],
  ['the proxy reports another error', 'success=false&error=invalid_request', 'login.oauthFailed'],
  ['the callback has no token or code', 'success=true', 'login.oauthInvalidCallback'],
  ['the callback omits its state', 'success=true&code=fake', 'login.oauthStateValidationFailed'],
  [
    'the callback has the wrong state',
    'success=true&code=fake&state=wrong',
    'login.oauthStateValidationFailed',
  ],
])('shows translated text when %s', async (_case, query, key) => {
  mockBrowser.mockResolvedValue({
    type: 'success',
    url: `veloq://oauth/callback?${query}`,
  });
  const handleOAuthLogin = signIn();

  await act(async () => {
    await handleOAuthLogin();
  });

  expect(shown()).toBe(key);
});

it('shows translated text when the code exchange returns no token', async () => {
  mockBrowser.mockImplementation(async () => ({
    type: 'success',
    url: `veloq://oauth/callback?success=true&code=fake&state=${lastState()}`,
  }));
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce({ ok: true })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });
  const handleOAuthLogin = signIn();

  await act(async () => {
    await handleOAuthLogin();
  });

  expect(shown()).toBe('login.oauthCodeExchangeFailed');
});

/** The state the flow registered with the proxy, read back off the request. */
function lastState(): string {
  const call = (global.fetch as jest.Mock).mock.calls[0];
  return JSON.parse(call[1].body).state;
}
