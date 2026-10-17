/**
 * Scenario: the athlete taps the intervals.icu sign-in button and Android
 * kills the app while the browser is in front. Approving starts a new process
 * from the redirect, and nothing in it is waiting for the browser.
 *
 * Expected behaviour: the sign-in screen completes the flow from the keychain,
 * showing progress while the code is redeemed, and signs the athlete in, which
 * is what the root layout takes onto the Feed. With
 * nothing stored it says the sign-in was interrupted rather than nothing.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';

import { useOAuthLogin } from '@/features/auth/hooks/useOAuthLogin';
import { holdInterruptedCallback } from '@/features/auth/lib/oauth';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('expo-web-browser', () => ({
  ...jest.requireActual('expo-web-browser'),
  openAuthSessionAsync: jest.fn(),
}));
jest.mock('expo-crypto', () => ({
  ...jest.requireActual('expo-crypto'),
  getRandomBytes: (length: number) => new Uint8Array(length).fill(7),
  digestStringAsync: jest.fn().mockResolvedValue('fake-challenge'),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  CryptoEncoding: { BASE64: 'base64' },
}));
jest.mock('expo-linking', () => ({
  ...jest.requireActual('expo-linking'),
  parse: (url: string) => ({
    queryParams: Object.fromEntries(new URL(url).searchParams.entries()),
  }),
}));
// The keychain outlives the process; module memory does not.
const mockKeychain = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  ...jest.requireActual('expo-secure-store'),
  getItemAsync: jest.fn(async (key: string) => mockKeychain.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockKeychain.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockKeychain.delete(key);
  }),
}));
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({}),
}));
jest.mock('@/shared/app/SyncDateRangeStore', () => ({
  useSyncDateRange: () => jest.fn(),
}));
jest.mock('@/shared/storage', () => ({
  clearAccountData: jest.fn().mockResolvedValue(undefined),
  clearAuthOnly: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/auth/lib/loginLibrary', () => ({
  resolveLoginLibrary: jest.fn().mockResolvedValue('wipe'),
}));
jest.mock('@/features/auth/lib/grantedScope', () => ({ recordGrantedScope: jest.fn() }));
const mockSetOAuthCredentials = jest.fn().mockResolvedValue(undefined);
jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: (select: (state: unknown) => unknown) =>
    select({ setOAuthCredentials: mockSetOAuthCredentials }),
}));
jest.mock('@/shared/app/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: true }),
}));

const mockBrowser = jest.mocked(WebBrowser.openAuthSessionAsync);
const originalFetch = global.fetch;
const setError = jest.fn();

/** Start a flow in a process that dies with the browser in front, handing back its state. */
async function startInDyingProcess(): Promise<string> {
  let dying: typeof import('@/features/auth/lib/oauth') | undefined;
  jest.isolateModules(() => {
    dying = require('@/features/auth/lib/oauth');
  });
  await new Promise<void>((opened) => {
    mockBrowser.mockImplementationOnce(() => {
      opened();
      return new Promise(() => {});
    });
    void dying!.startOAuthFlow();
  });
  return JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body).state;
}

/** The code redemption answers only when `answer` is called. */
function redemptionHeld() {
  let answer: () => void = () => {};
  (global.fetch as jest.Mock).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        answer = () =>
          resolve({
            ok: true,
            json: async () => ({
              access_token: 'resumed-token',
              athlete_id: 'i7',
              athlete_name: 'Ana',
              scope: 'ACTIVITY:READ',
            }),
          });
      })
  );
  return () => answer();
}

/** The last message the error slot was handed. */
function shown(): string | null {
  const calls = setError.mock.calls;
  return calls.length === 0 ? null : calls[calls.length - 1][0];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockKeychain.clear();
  global.fetch = jest.fn().mockResolvedValue({ ok: true });
});

afterAll(() => {
  global.fetch = originalFetch;
});

it('completes a flow the killed process started, showing progress, and signs the athlete in', async () => {
  const state = await startInDyingProcess();
  const answer = redemptionHeld();
  holdInterruptedCallback(`veloq://oauth/callback?success=true&code=onetime&state=${state}`);

  const { result } = await renderHook(() => useOAuthLogin({ setError }));

  await waitFor(() => expect(result.current.isLoading).toBe(true));
  expect(mockSetOAuthCredentials).not.toHaveBeenCalled();

  await act(async () => answer());

  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(mockSetOAuthCredentials).toHaveBeenCalledWith('resumed-token', 'i7', 'Ana');
  expect(shown()).toBeNull();
  expect(mockKeychain.size).toBe(0);
});

it('completes a redirect held after the sign-in screen is already showing', async () => {
  const state = await startInDyingProcess();
  const { result } = await renderHook(() => useOAuthLogin({ setError }));
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: true,
    json: async () => ({ access_token: 'late-token', athlete_id: 'i7' }),
  });

  await act(async () => {
    holdInterruptedCallback(`veloq://oauth/callback?success=true&code=onetime&state=${state}`);
  });

  await waitFor(() => expect(mockSetOAuthCredentials).toHaveBeenCalledWith('late-token', 'i7', ''));
  expect(result.current.isLoading).toBe(false);
});

it('says the sign-in was interrupted when nothing is stored', async () => {
  holdInterruptedCallback('veloq://oauth/callback?success=true&code=onetime&state=lost');

  const { result } = await renderHook(() => useOAuthLogin({ setError }));

  await waitFor(() => expect(shown()).toBe('login.oauthInterrupted'));
  expect(result.current.isLoading).toBe(false);
  expect(global.fetch).not.toHaveBeenCalled();
  expect(mockSetOAuthCredentials).not.toHaveBeenCalled();
});

it('completes a held redirect once, not again on a second sign-in screen', async () => {
  const state = await startInDyingProcess();
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: true,
    json: async () => ({ access_token: 'tok', athlete_id: 'i7' }),
  });
  holdInterruptedCallback(`veloq://oauth/callback?success=true&code=onetime&state=${state}`);

  await renderHook(() => useOAuthLogin({ setError }));
  await waitFor(() => expect(mockSetOAuthCredentials).toHaveBeenCalledTimes(1));
  await renderHook(() => useOAuthLogin({ setError }));
  await act(async () => {});

  expect(mockSetOAuthCredentials).toHaveBeenCalledTimes(1);
  expect(global.fetch).toHaveBeenCalledTimes(2);
});
