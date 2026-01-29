/**
 * AuthStore Tests
 *
 * Tests the authentication state management including:
 * - Credential persistence (SecureStore)
 * - OAuth vs API Key authentication modes
 * - Demo mode transitions
 * - Session expiry handling
 * - State consistency across operations
 */

import * as SecureStore from 'expo-secure-store';
import { useAuthStore, getStoredCredentials, DEMO_ATHLETE_ID } from '@/providers/AuthStore';

// Get mock functions with proper typing
const mockGetItemAsync = SecureStore.getItemAsync as jest.MockedFunction<
  typeof SecureStore.getItemAsync
>;
const mockSetItemAsync = SecureStore.setItemAsync as jest.MockedFunction<
  typeof SecureStore.setItemAsync
>;
const mockDeleteItemAsync = SecureStore.deleteItemAsync as jest.MockedFunction<
  typeof SecureStore.deleteItemAsync
>;

// Storage keys (must match AuthStore.ts)
const API_KEY_STORAGE_KEY = 'intervals_api_key';
const ATHLETE_ID_STORAGE_KEY = 'intervals_athlete_id';
const ACCESS_TOKEN_STORAGE_KEY = 'intervals_access_token';

describe('AuthStore', () => {
  beforeEach(() => {
    // Reset store to initial state
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

    // Clear all mocks
    jest.clearAllMocks();
  });

  describe('initialize()', () => {
    it('loads API key credentials from SecureStore', async () => {
      mockGetItemAsync.mockImplementation(async (key) => {
        if (key === API_KEY_STORAGE_KEY) return 'test-api-key';
        if (key === ATHLETE_ID_STORAGE_KEY) return 'i12345';
        if (key === ACCESS_TOKEN_STORAGE_KEY) return null;
        return null;
      });

      await useAuthStore.getState().initialize();

      const state = useAuthStore.getState();
      expect(state.apiKey).toBe('test-api-key');
      expect(state.athleteId).toBe('i12345');
      expect(state.accessToken).toBeNull();
      expect(state.isAuthenticated).toBe(true);
      expect(state.authMethod).toBe('apiKey');
      expect(state.isLoading).toBe(false);
    });

    it('loads OAuth credentials from SecureStore', async () => {
      mockGetItemAsync.mockImplementation(async (key) => {
        if (key === API_KEY_STORAGE_KEY) return null;
        if (key === ATHLETE_ID_STORAGE_KEY) return 'i67890';
        if (key === ACCESS_TOKEN_STORAGE_KEY) return 'oauth-token-xyz';
        return null;
      });

      await useAuthStore.getState().initialize();

      const state = useAuthStore.getState();
      expect(state.accessToken).toBe('oauth-token-xyz');
      expect(state.athleteId).toBe('i67890');
      expect(state.apiKey).toBeNull();
      expect(state.isAuthenticated).toBe(true);
      expect(state.authMethod).toBe('oauth');
    });

    it('prioritizes OAuth over API key when both exist', async () => {
      // Edge case: both credentials exist (shouldn't happen, but test the priority)
      mockGetItemAsync.mockImplementation(async (key) => {
        if (key === API_KEY_STORAGE_KEY) return 'api-key-123';
        if (key === ATHLETE_ID_STORAGE_KEY) return 'i99999';
        if (key === ACCESS_TOKEN_STORAGE_KEY) return 'oauth-token-456';
        return null;
      });

      await useAuthStore.getState().initialize();

      const state = useAuthStore.getState();
      expect(state.authMethod).toBe('oauth');
      expect(state.isAuthenticated).toBe(true);
    });

    it('sets unauthenticated state when no credentials found', async () => {
      mockGetItemAsync.mockResolvedValue(null);

      await useAuthStore.getState().initialize();

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(false);
      expect(state.authMethod).toBeNull();
      expect(state.isLoading).toBe(false);
    });

    it('requires both athleteId and credential for authentication', async () => {
      // API key exists but no athlete ID
      mockGetItemAsync.mockImplementation(async (key) => {
        if (key === API_KEY_STORAGE_KEY) return 'api-key-orphan';
        return null;
      });

      await useAuthStore.getState().initialize();

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(false);
      expect(state.authMethod).toBeNull();
    });

    it('handles SecureStore read errors gracefully', async () => {
      mockGetItemAsync.mockRejectedValue(new Error('SecureStore unavailable'));

      await useAuthStore.getState().initialize();

      const state = useAuthStore.getState();
      expect(state.isLoading).toBe(false);
      expect(state.isAuthenticated).toBe(false);
      expect(state.authMethod).toBeNull();
    });

    it('reads all three keys in parallel', async () => {
      mockGetItemAsync.mockResolvedValue(null);

      await useAuthStore.getState().initialize();

      // Verify all three keys were requested
      expect(mockGetItemAsync).toHaveBeenCalledTimes(3);
      expect(mockGetItemAsync).toHaveBeenCalledWith(API_KEY_STORAGE_KEY);
      expect(mockGetItemAsync).toHaveBeenCalledWith(ATHLETE_ID_STORAGE_KEY);
      expect(mockGetItemAsync).toHaveBeenCalledWith(ACCESS_TOKEN_STORAGE_KEY);
    });
  });

  describe('setCredentials() - API Key Auth', () => {
    it('saves API key and athlete ID to SecureStore', async () => {
      await useAuthStore.getState().setCredentials('my-api-key', 'i11111');

      expect(mockSetItemAsync).toHaveBeenCalledWith(
        API_KEY_STORAGE_KEY,
        'my-api-key',
        expect.objectContaining({ keychainAccessible: expect.any(Number) })
      );
      expect(mockSetItemAsync).toHaveBeenCalledWith(
        ATHLETE_ID_STORAGE_KEY,
        'i11111',
        expect.objectContaining({ keychainAccessible: expect.any(Number) })
      );
    });

    it('clears OAuth token when setting API key credentials', async () => {
      // Start with OAuth
      useAuthStore.setState({
        accessToken: 'old-oauth-token',
        authMethod: 'oauth',
      });

      await useAuthStore.getState().setCredentials('new-api-key', 'i22222');

      expect(mockDeleteItemAsync).toHaveBeenCalledWith(ACCESS_TOKEN_STORAGE_KEY);
      expect(useAuthStore.getState().accessToken).toBeNull();
    });

    it('updates state correctly after setting credentials', async () => {
      await useAuthStore.getState().setCredentials('test-key', 'i33333');

      const state = useAuthStore.getState();
      expect(state.apiKey).toBe('test-key');
      expect(state.athleteId).toBe('i33333');
      expect(state.isAuthenticated).toBe(true);
      expect(state.authMethod).toBe('apiKey');
      expect(state.isDemoMode).toBe(false);
    });

    it('exits demo mode when setting real credentials', async () => {
      useAuthStore.setState({ isDemoMode: true, authMethod: 'demo' });

      await useAuthStore.getState().setCredentials('real-key', 'i44444');

      expect(useAuthStore.getState().isDemoMode).toBe(false);
      expect(useAuthStore.getState().authMethod).toBe('apiKey');
    });
  });

  describe('setOAuthCredentials()', () => {
    it('saves OAuth token and athlete ID to SecureStore', async () => {
      await useAuthStore.getState().setOAuthCredentials('oauth-token-abc', 'i55555');

      expect(mockSetItemAsync).toHaveBeenCalledWith(
        ACCESS_TOKEN_STORAGE_KEY,
        'oauth-token-abc',
        expect.objectContaining({ keychainAccessible: expect.any(Number) })
      );
      expect(mockSetItemAsync).toHaveBeenCalledWith(
        ATHLETE_ID_STORAGE_KEY,
        'i55555',
        expect.objectContaining({ keychainAccessible: expect.any(Number) })
      );
    });

    it('clears API key when setting OAuth credentials', async () => {
      useAuthStore.setState({
        apiKey: 'old-api-key',
        authMethod: 'apiKey',
      });

      await useAuthStore.getState().setOAuthCredentials('new-oauth-token', 'i66666');

      expect(mockDeleteItemAsync).toHaveBeenCalledWith(API_KEY_STORAGE_KEY);
      expect(useAuthStore.getState().apiKey).toBeNull();
    });

    it('sets athlete info when name provided', async () => {
      await useAuthStore.getState().setOAuthCredentials('token', 'i77777', 'John Doe');

      const state = useAuthStore.getState();
      expect(state.athlete).not.toBeNull();
      expect(state.athlete?.id).toBe('i77777');
      expect(state.athlete?.name).toBe('John Doe');
    });

    it('does not set athlete when name not provided', async () => {
      await useAuthStore.getState().setOAuthCredentials('token', 'i88888');

      expect(useAuthStore.getState().athlete).toBeNull();
    });

    it('updates state correctly after OAuth login', async () => {
      await useAuthStore.getState().setOAuthCredentials('oauth-xyz', 'i99999');

      const state = useAuthStore.getState();
      expect(state.accessToken).toBe('oauth-xyz');
      expect(state.athleteId).toBe('i99999');
      expect(state.isAuthenticated).toBe(true);
      expect(state.authMethod).toBe('oauth');
      expect(state.isDemoMode).toBe(false);
    });
  });

  describe('clearCredentials()', () => {
    it('deletes all credentials from SecureStore', async () => {
      useAuthStore.setState({
        apiKey: 'some-key',
        accessToken: 'some-token',
        athleteId: 'i12345',
        isAuthenticated: true,
      });

      await useAuthStore.getState().clearCredentials();

      expect(mockDeleteItemAsync).toHaveBeenCalledWith(API_KEY_STORAGE_KEY);
      expect(mockDeleteItemAsync).toHaveBeenCalledWith(ATHLETE_ID_STORAGE_KEY);
      expect(mockDeleteItemAsync).toHaveBeenCalledWith(ACCESS_TOKEN_STORAGE_KEY);
    });

    it('resets all auth state', async () => {
      useAuthStore.setState({
        apiKey: 'key',
        accessToken: 'token',
        athleteId: 'id',
        athlete: { id: 'id', name: 'Test' } as any,
        isAuthenticated: true,
        isDemoMode: true,
        authMethod: 'oauth',
      });

      await useAuthStore.getState().clearCredentials();

      const state = useAuthStore.getState();
      expect(state.apiKey).toBeNull();
      expect(state.accessToken).toBeNull();
      expect(state.athleteId).toBeNull();
      expect(state.athlete).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.isDemoMode).toBe(false);
      expect(state.authMethod).toBeNull();
    });
  });

  describe('Demo Mode', () => {
    it('enterDemoMode() sets correct state', () => {
      useAuthStore.getState().enterDemoMode();

      const state = useAuthStore.getState();
      expect(state.isDemoMode).toBe(true);
      expect(state.isAuthenticated).toBe(true);
      expect(state.authMethod).toBe('demo');
      expect(state.athleteId).toBe(DEMO_ATHLETE_ID);
    });

    it('enterDemoMode() clears athlete profile', () => {
      useAuthStore.setState({ athlete: { id: 'i123', name: 'Real User' } as any });

      useAuthStore.getState().enterDemoMode();

      expect(useAuthStore.getState().athlete).toBeNull();
    });

    it('exitDemoMode() resets to unauthenticated', () => {
      useAuthStore.setState({
        isDemoMode: true,
        isAuthenticated: true,
        authMethod: 'demo',
        athleteId: DEMO_ATHLETE_ID,
        hideDemoBanner: true,
      });

      useAuthStore.getState().exitDemoMode();

      const state = useAuthStore.getState();
      expect(state.isDemoMode).toBe(false);
      expect(state.isAuthenticated).toBe(false);
      expect(state.authMethod).toBeNull();
      expect(state.athleteId).toBeNull();
      expect(state.hideDemoBanner).toBe(false);
    });

    it('DEMO_ATHLETE_ID constant equals "demo"', () => {
      expect(DEMO_ATHLETE_ID).toBe('demo');
    });
  });

  describe('handleSessionExpired()', () => {
    it('clears OAuth credentials and sets session expired', async () => {
      useAuthStore.setState({
        accessToken: 'expired-token',
        athleteId: 'i12345',
        isAuthenticated: true,
        authMethod: 'oauth',
      });

      await useAuthStore.getState().handleSessionExpired('token_expired');

      expect(mockDeleteItemAsync).toHaveBeenCalledWith(ACCESS_TOKEN_STORAGE_KEY);
      expect(mockDeleteItemAsync).toHaveBeenCalledWith(ATHLETE_ID_STORAGE_KEY);

      const state = useAuthStore.getState();
      expect(state.accessToken).toBeNull();
      expect(state.athleteId).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.authMethod).toBeNull();
      expect(state.sessionExpired).toBe('token_expired');
    });

    it('only affects OAuth auth method, not API key', async () => {
      useAuthStore.setState({
        apiKey: 'my-api-key',
        athleteId: 'i12345',
        isAuthenticated: true,
        authMethod: 'apiKey',
      });

      await useAuthStore.getState().handleSessionExpired('token_expired');

      // Should NOT have called delete
      expect(mockDeleteItemAsync).not.toHaveBeenCalled();

      const state = useAuthStore.getState();
      expect(state.apiKey).toBe('my-api-key');
      expect(state.isAuthenticated).toBe(true);
      expect(state.sessionExpired).toBeNull();
    });

    it('only affects OAuth auth method, not demo mode', async () => {
      useAuthStore.setState({
        isDemoMode: true,
        isAuthenticated: true,
        authMethod: 'demo',
        athleteId: DEMO_ATHLETE_ID,
      });

      await useAuthStore.getState().handleSessionExpired('token_revoked');

      expect(mockDeleteItemAsync).not.toHaveBeenCalled();
      expect(useAuthStore.getState().isDemoMode).toBe(true);
      expect(useAuthStore.getState().sessionExpired).toBeNull();
    });

    it('supports token_revoked reason', async () => {
      useAuthStore.setState({ authMethod: 'oauth', accessToken: 'token' });

      await useAuthStore.getState().handleSessionExpired('token_revoked');

      expect(useAuthStore.getState().sessionExpired).toBe('token_revoked');
    });

    it('defaults to token_expired if no reason provided', async () => {
      useAuthStore.setState({ authMethod: 'oauth', accessToken: 'token' });

      await useAuthStore.getState().handleSessionExpired();

      expect(useAuthStore.getState().sessionExpired).toBe('token_expired');
    });
  });

  describe('clearSessionExpired()', () => {
    it('clears the session expired state', () => {
      useAuthStore.setState({ sessionExpired: 'token_expired' });

      useAuthStore.getState().clearSessionExpired();

      expect(useAuthStore.getState().sessionExpired).toBeNull();
    });
  });

  describe('getStoredCredentials()', () => {
    it('returns current credentials synchronously', () => {
      useAuthStore.setState({
        apiKey: 'sync-test-key',
        accessToken: 'sync-test-token',
        athleteId: 'i-sync',
        authMethod: 'apiKey',
      });

      const creds = getStoredCredentials();

      expect(creds.apiKey).toBe('sync-test-key');
      expect(creds.accessToken).toBe('sync-test-token');
      expect(creds.athleteId).toBe('i-sync');
      expect(creds.authMethod).toBe('apiKey');
    });

    it('returns null values when not authenticated', () => {
      const creds = getStoredCredentials();

      expect(creds.apiKey).toBeNull();
      expect(creds.accessToken).toBeNull();
      expect(creds.athleteId).toBeNull();
      expect(creds.authMethod).toBeNull();
    });
  });

  describe('State Consistency', () => {
    it('maintains consistency when switching from API key to OAuth', async () => {
      // Start with API key
      await useAuthStore.getState().setCredentials('api-key-1', 'i11111');

      let state = useAuthStore.getState();
      expect(state.apiKey).toBe('api-key-1');
      expect(state.accessToken).toBeNull();
      expect(state.authMethod).toBe('apiKey');

      // Switch to OAuth
      await useAuthStore.getState().setOAuthCredentials('oauth-token-1', 'i22222');

      state = useAuthStore.getState();
      expect(state.apiKey).toBeNull();
      expect(state.accessToken).toBe('oauth-token-1');
      expect(state.authMethod).toBe('oauth');
    });

    it('maintains consistency when switching from OAuth to API key', async () => {
      // Start with OAuth
      await useAuthStore.getState().setOAuthCredentials('oauth-first', 'i33333');

      let state = useAuthStore.getState();
      expect(state.accessToken).toBe('oauth-first');
      expect(state.authMethod).toBe('oauth');

      // Switch to API key
      await useAuthStore.getState().setCredentials('api-key-second', 'i44444');

      state = useAuthStore.getState();
      expect(state.accessToken).toBeNull();
      expect(state.apiKey).toBe('api-key-second');
      expect(state.authMethod).toBe('apiKey');
    });

    it('maintains consistency through demo mode cycle', async () => {
      // Start authenticated
      await useAuthStore.getState().setCredentials('real-key', 'i55555');

      // Enter demo (this should NOT clear stored credentials in SecureStore)
      useAuthStore.getState().enterDemoMode();
      expect(useAuthStore.getState().isDemoMode).toBe(true);

      // Exit demo
      useAuthStore.getState().exitDemoMode();

      // Should be fully logged out
      const state = useAuthStore.getState();
      expect(state.isDemoMode).toBe(false);
      expect(state.isAuthenticated).toBe(false);
      // Note: The real credentials are still in SecureStore, but state is cleared
    });

    it('concurrent setCredentials calls result in last-write-wins', async () => {
      // Fire two credential updates concurrently
      const promise1 = useAuthStore.getState().setCredentials('key-1', 'i11111');
      const promise2 = useAuthStore.getState().setCredentials('key-2', 'i22222');

      await Promise.all([promise1, promise2]);

      // The last state update should win
      const state = useAuthStore.getState();
      expect(state.apiKey).toBe('key-2');
      expect(state.athleteId).toBe('i22222');
    });
  });

  describe('Edge Cases', () => {
    it('handles empty string credentials', async () => {
      mockGetItemAsync.mockImplementation(async (key) => {
        if (key === API_KEY_STORAGE_KEY) return '';
        if (key === ATHLETE_ID_STORAGE_KEY) return '';
        return null;
      });

      await useAuthStore.getState().initialize();

      /**
       * BUG: Empty strings ARE accepted as valid credentials
       *
       * CORRECT behavior: Empty strings should NOT be valid credentials.
       * The store should treat empty strings as "no credential" and
       * NOT set isAuthenticated to true.
       *
       * FIX needed in AuthStore: Check string length, not just existence
       *   if (apiKey && apiKey.trim().length > 0) { ... }
       */
      const state = useAuthStore.getState();
      // Should NOT accept empty strings as valid credentials
      expect(state.apiKey).toBeNull();
      expect(state.athleteId).toBeNull();
    });

    it('handles whitespace-only credentials', async () => {
      mockGetItemAsync.mockImplementation(async (key) => {
        if (key === API_KEY_STORAGE_KEY) return '   ';
        if (key === ATHLETE_ID_STORAGE_KEY) return '  i123  ';
        return null;
      });

      await useAuthStore.getState().initialize();

      /**
       * BUG: Whitespace-only API key is accepted as valid
       *
       * CORRECT behavior:
       * - Whitespace-only apiKey should be treated as null (invalid)
       * - athleteId with surrounding whitespace should be trimmed OR rejected
       *
       * FIX needed: Trim credentials and check for empty after trim
       */
      const state = useAuthStore.getState();
      // Whitespace-only apiKey should NOT be valid
      expect(state.apiKey).toBeNull();
      // athleteId should be trimmed OR null (whitespace-only)
      expect(state.athleteId).toBe('i123'); // Trimmed
    });

    it('setAthlete updates athlete without affecting auth state', () => {
      useAuthStore.setState({
        isAuthenticated: true,
        authMethod: 'apiKey',
        athleteId: 'i123',
      });

      useAuthStore.getState().setAthlete({
        id: 'i123',
        name: 'Test User',
        email: 'test@example.com',
      } as any);

      const state = useAuthStore.getState();
      expect(state.athlete?.name).toBe('Test User');
      expect(state.isAuthenticated).toBe(true);
      expect(state.authMethod).toBe('apiKey');
    });

    it('hideDemoBanner can be toggled independently', () => {
      useAuthStore.setState({ isDemoMode: true });

      useAuthStore.getState().setHideDemoBanner(true);
      expect(useAuthStore.getState().hideDemoBanner).toBe(true);

      useAuthStore.getState().setHideDemoBanner(false);
      expect(useAuthStore.getState().hideDemoBanner).toBe(false);
    });
  });
});
