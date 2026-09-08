/**
 * Scenario: a headless start, a push waking the background task with no React
 * tree mounted, so nothing has called `initialize()`.
 *
 * Expected behaviour: the credential is read from SecureStore on demand, once,
 * and a caller that asks again gets the hydrated store rather than a second
 * read.
 */

import * as SecureStore from 'expo-secure-store';
import {
  useAuthStore,
  getStoredCredentials,
  ensureCredentialsHydrated,
} from '@/shared/app/AuthStore';

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(() => null),
}));

const mockGetItemAsync = SecureStore.getItemAsync as jest.MockedFunction<
  typeof SecureStore.getItemAsync
>;

const ATHLETE_ID_STORAGE_KEY = 'intervals_athlete_id';
const ACCESS_TOKEN_STORAGE_KEY = 'intervals_access_token';

const unhydrated = () =>
  useAuthStore.setState({
    apiKey: null,
    accessToken: null,
    athleteId: null,
    athlete: null,
    isLoading: true,
    isAuthenticated: false,
    isDemoMode: false,
    hideDemoBanner: false,
    authMethod: null,
    sessionExpired: null,
  });

describe('ensureCredentialsHydrated', () => {
  beforeEach(() => {
    unhydrated();
    jest.clearAllMocks();
    mockGetItemAsync.mockImplementation(async (key) => {
      if (key === ACCESS_TOKEN_STORAGE_KEY) return 'token-abc';
      if (key === ATHLETE_ID_STORAGE_KEY) return '12345';
      return null;
    });
  });

  it('reads the credential a headless start never hydrated', async () => {
    expect(getStoredCredentials().athleteId).toBeNull();

    await ensureCredentialsHydrated();

    expect(getStoredCredentials().athleteId).toBe('12345');
    expect(getStoredCredentials().authMethod).toBe('oauth');
  });

  it('leaves an already hydrated store alone', async () => {
    await ensureCredentialsHydrated();
    mockGetItemAsync.mockClear();

    await ensureCredentialsHydrated();

    expect(mockGetItemAsync).not.toHaveBeenCalled();
    expect(getStoredCredentials().athleteId).toBe('12345');
  });

  it('reads once when two callers race the same cold start', async () => {
    await Promise.all([ensureCredentialsHydrated(), ensureCredentialsHydrated()]);

    expect(mockGetItemAsync).toHaveBeenCalledTimes(3);
    expect(getStoredCredentials().athleteId).toBe('12345');
  });

  it('settles a signed-out store instead of reading on every call', async () => {
    mockGetItemAsync.mockResolvedValue(null);

    await ensureCredentialsHydrated();
    expect(getStoredCredentials().athleteId).toBeNull();
    expect(useAuthStore.getState().isLoading).toBe(false);

    mockGetItemAsync.mockClear();
    await ensureCredentialsHydrated();
    expect(mockGetItemAsync).not.toHaveBeenCalled();
  });

  it('settles when the read throws, so a failure is not retried forever', async () => {
    mockGetItemAsync.mockRejectedValue(new Error('keychain locked'));

    await ensureCredentialsHydrated();
    expect(useAuthStore.getState().isLoading).toBe(false);

    mockGetItemAsync.mockClear();
    await ensureCredentialsHydrated();
    expect(mockGetItemAsync).not.toHaveBeenCalled();
  });
});
