/**
 * Scenario: the Rust sync service is the only holder of intervals.icu
 * credentials. Every auth-store transition must hand it the current credential
 * or clear it, and the store's `apiKey` method name must reach the engine as
 * `api_key`.
 */

import * as SecureStore from 'expo-secure-store';

import { pushCredentialsToEngine, useAuthStore } from '@/shared/app/AuthStore';
import { getEngine } from '@/shared/native/engine';

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

const setSyncCredentials = jest.fn();
const clearSyncCredentials = jest.fn();

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;
const mockGetItemAsync = SecureStore.getItemAsync as jest.MockedFunction<
  typeof SecureStore.getItemAsync
>;

function resetStore() {
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
}

describe('sync credential ownership', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetStore();
    mockGetEngine.mockReturnValue({
      setSyncCredentials,
      clearSyncCredentials,
    } as unknown as ReturnType<typeof getEngine>);
  });

  it('sends an API key as api_key with the athlete id', async () => {
    await useAuthStore.getState().setCredentials('secret-key', 'i12345');

    expect(setSyncCredentials).toHaveBeenCalledWith('api_key', 'secret-key', 'i12345');
    expect(clearSyncCredentials).not.toHaveBeenCalled();
  });

  it('sends an OAuth token as oauth', async () => {
    await useAuthStore.getState().setOAuthCredentials('token-abc', 'i999');

    expect(setSyncCredentials).toHaveBeenCalledWith('oauth', 'token-abc', 'i999');
  });

  it('pushes the credential rehydrated from secure storage', async () => {
    mockGetItemAsync.mockImplementation(async (key) => {
      if (key === 'intervals_api_key') return 'stored-key';
      if (key === 'intervals_athlete_id') return 'i42';
      return null;
    });

    await useAuthStore.getState().initialize();

    expect(setSyncCredentials).toHaveBeenCalledWith('api_key', 'stored-key', 'i42');
  });

  it('clears the engine credential on logout', async () => {
    await useAuthStore.getState().setCredentials('secret-key', 'i12345');
    setSyncCredentials.mockClear();

    await useAuthStore.getState().clearCredentials();

    expect(clearSyncCredentials).toHaveBeenCalled();
    expect(setSyncCredentials).not.toHaveBeenCalled();
  });

  it('clears the engine credential when an OAuth session expires', async () => {
    await useAuthStore.getState().setOAuthCredentials('token-abc', 'i999');
    setSyncCredentials.mockClear();

    await useAuthStore.getState().handleSessionExpired('token_expired');

    expect(clearSyncCredentials).toHaveBeenCalled();
  });

  it('holds no credential in demo mode', () => {
    useAuthStore.getState().enterDemoMode();

    expect(clearSyncCredentials).toHaveBeenCalled();
    expect(setSyncCredentials).not.toHaveBeenCalled();
  });

  it('is a no-op before the engine exists', () => {
    mockGetEngine.mockReturnValue(null);

    expect(() => pushCredentialsToEngine()).not.toThrow();
    expect(setSyncCredentials).not.toHaveBeenCalled();
    expect(clearSyncCredentials).not.toHaveBeenCalled();
  });

  it('clears rather than sends a half-populated credential', () => {
    useAuthStore.setState({ authMethod: 'oauth', accessToken: null, athleteId: 'i1' });

    pushCredentialsToEngine();

    expect(clearSyncCredentials).toHaveBeenCalled();
    expect(setSyncCredentials).not.toHaveBeenCalled();
  });
});
