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
  });

  describe('setCredentials() - API Key Auth', () => {
    it('setCredentials with whitespace-only apiKey does not set isAuthenticated', async () => {
      await useAuthStore.getState().setCredentials('   ', 'i12345');
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });

    it('setCredentials trims surrounding whitespace from valid credentials', async () => {
      await useAuthStore.getState().setCredentials('  my-key  ', '  i99999  ');
      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(true);
      expect(state.apiKey).toBe('my-key');
      expect(state.athleteId).toBe('i99999');
    });
  });

  describe('setOAuthCredentials()', () => {
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
  });
});
