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

import { Alert } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { waitFor } from '@testing-library/react-native';
import { useAuthStore, getStoredCredentials, DEMO_ATHLETE_ID } from '@/shared/app/AuthStore';
import { getEngine } from '@/shared/native/engine';
import { useUploadPermissionStore } from '@/features/recording/stores/UploadPermissionStore';
import { useNotificationPreferences } from '@/features/settings/stores/NotificationPreferencesStore';
import { unregisterPushToken } from '@/features/settings/lib/pushTokenRegistration';
import { holdRecordingOnSignOut } from '@/features/recording/lib/holdRecordingOnSignOut';

jest.mock('@/features/recording/lib/holdRecordingOnSignOut', () => ({
  holdRecordingOnSignOut: jest.fn(async () => undefined),
}));

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

jest.mock('@/features/settings/lib/pushTokenRegistration', () => ({
  registerPushToken: jest.fn(async () => true),
  unregisterPushToken: jest.fn(async () => true),
}));

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
const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

// Storage keys (must match AuthStore.ts)
const API_KEY_STORAGE_KEY = 'intervals_api_key';
const ATHLETE_ID_STORAGE_KEY = 'intervals_athlete_id';
const ACCESS_TOKEN_STORAGE_KEY = 'intervals_access_token';
const API_KEY_ATHLETE_STORAGE_KEY = 'intervals_api_key_athlete_id';

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
    useNotificationPreferences.setState({ enabled: false, privacyAccepted: false });
  });

  it('holds a ride before explicit sign-out clears its athlete', async () => {
    useAuthStore.setState({ athleteId: 'i1', isAuthenticated: true, authMethod: 'oauth' });
    await useAuthStore.getState().clearCredentials();
    expect(holdRecordingOnSignOut).toHaveBeenCalledWith('i1');
  });

  it('holds a ride before a rejected credential clears its athlete', async () => {
    useAuthStore.setState({ athleteId: 'i1', isAuthenticated: true, authMethod: 'oauth' });
    await useAuthStore.getState().handleSessionExpired();
    expect(holdRecordingOnSignOut).toHaveBeenCalledWith('i1');
  });

  describe('initialize()', () => {
    it('restores the rejected-key notice after relaunch without signing in', async () => {
      mockGetItemAsync.mockImplementation(async (key) => {
        if (key === API_KEY_STORAGE_KEY) return 'rejected-key';
        if (key === API_KEY_ATHLETE_STORAGE_KEY) return 'i12345';
        return null;
      });
      await useAuthStore.getState().initialize();
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().sessionExpired).toBe('key_rejected');
    });
    it('does not call a key refused when the athlete id would not read', async () => {
      mockGetItemAsync.mockImplementation(async (key) => {
        if (key === API_KEY_STORAGE_KEY) return 'good-key';
        if (key === API_KEY_ATHLETE_STORAGE_KEY) return 'i12345';
        if (key === ATHLETE_ID_STORAGE_KEY) throw new Error('keychain locked');
        return null;
      });
      await useAuthStore.getState().initialize();
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().sessionExpired).toBeNull();
    });
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

  /**
   * Scenario: a launch that finds no usable credential. Demo data left by a
   * force quit is discarded by the athlete-id comparison in the root layout,
   * so the store has no reason to wipe the database, and every signed-out
   * launch takes this path.
   *
   * Expected behaviour: initialize never calls clear() on the engine.
   */
  describe('initialize() and the database', () => {
    const clear = jest.fn();
    const setSyncCredentials = jest.fn();
    const clearSyncCredentials = jest.fn();

    beforeEach(() => {
      mockGetEngine.mockReturnValue({
        clear,
        setSyncCredentials,
        clearSyncCredentials,
      } as unknown as ReturnType<typeof getEngine>);
    });

    afterEach(() => {
      mockGetEngine.mockReset();
    });

    it('keeps the database when no credentials are stored', async () => {
      mockGetItemAsync.mockResolvedValue(null);

      await useAuthStore.getState().initialize();

      expect(clear).not.toHaveBeenCalled();
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });

    it('keeps the database when the stored credentials are whitespace only', async () => {
      mockGetItemAsync.mockResolvedValue('   ');

      await useAuthStore.getState().initialize();

      expect(clear).not.toHaveBeenCalled();
    });

    it('keeps the database when an athlete id is stored without a credential', async () => {
      mockGetItemAsync.mockImplementation(async (key) => {
        if (key === ATHLETE_ID_STORAGE_KEY) return 'i12345';
        return null;
      });

      await useAuthStore.getState().initialize();

      expect(clear).not.toHaveBeenCalled();
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });

    it('keeps the database across repeated credential-free launches', async () => {
      mockGetItemAsync.mockResolvedValue(null);

      await useAuthStore.getState().initialize();
      await useAuthStore.getState().initialize();

      expect(clear).not.toHaveBeenCalled();
    });

    it('keeps the database when SecureStore throws', async () => {
      mockGetItemAsync.mockRejectedValue(new Error('keychain unavailable'));

      await useAuthStore.getState().initialize();

      expect(clear).not.toHaveBeenCalled();
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });
  });

  describe('setCredentials() - API Key Auth', () => {
    it('turns off a carried-over push preference for an API-key athlete', async () => {
      useNotificationPreferences.setState({ enabled: true, privacyAccepted: true });
      await useAuthStore.getState().setCredentials('key', 'i12345');
      expect(useNotificationPreferences.getState().enabled).toBe(false);
    });
    it('deletes a queued offline key after API-key sign-in', async () => {
      await useAuthStore.getState().setCredentials('key', 'i12345');
      expect(mockDeleteItemAsync).toHaveBeenCalledWith(
        'intervals_pending_api_key',
        expect.anything()
      );
    });
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
    it('deletes a queued offline key after OAuth sign-in', async () => {
      await useAuthStore.getState().setOAuthCredentials('token', 'i12345');
      expect(mockDeleteItemAsync).toHaveBeenCalledWith(
        'intervals_pending_api_key',
        expect.anything()
      );
    });
    it('clears API key when setting OAuth credentials', async () => {
      useAuthStore.setState({
        apiKey: 'old-api-key',
        authMethod: 'apiKey',
      });

      await useAuthStore.getState().setOAuthCredentials('new-oauth-token', 'i66666');

      expect(mockDeleteItemAsync).toHaveBeenCalledWith(API_KEY_STORAGE_KEY, expect.anything());
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
    it('clears the pending unregister when sign-out cannot send it', async () => {
      jest.mocked(unregisterPushToken).mockResolvedValueOnce(false);
      useNotificationPreferences.setState({ enabled: true, privacyAccepted: true });
      useAuthStore.setState({ authMethod: 'oauth', athleteId: 'i12345', accessToken: 'token' });
      await useAuthStore.getState().clearCredentials();
      const prefs = useNotificationPreferences.getState();
      expect(prefs.pendingUnregister).toBe(false);
      expect(prefs.pendingUnregisterAthleteId).toBeNull();
    });
    it('waits for the OAuth unregister before deleting the credential', async () => {
      let finish: (success: boolean) => void = () => {};
      jest.mocked(unregisterPushToken).mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            finish = resolve;
          })
      );
      useNotificationPreferences.setState({ enabled: true, privacyAccepted: true });
      useAuthStore.setState({ authMethod: 'oauth', athleteId: 'i12345', accessToken: 'token' });
      const clearing = useAuthStore.getState().clearCredentials();
      await waitFor(() => expect(unregisterPushToken).toHaveBeenCalledWith('i12345'));
      expect(mockDeleteItemAsync).not.toHaveBeenCalled();
      finish(true);
      await clearing;
      expect(mockDeleteItemAsync).toHaveBeenCalledWith(ACCESS_TOKEN_STORAGE_KEY, expect.anything());
    });
    it('records no unregister for an API-key athlete, who has no token to prove it', async () => {
      jest.mocked(unregisterPushToken).mockResolvedValue(false);
      useNotificationPreferences.setState({
        enabled: true,
        privacyAccepted: true,
        pendingUnregister: false,
        pendingUnregisterAthleteId: null,
      });
      useAuthStore.setState({ authMethod: 'apiKey', athleteId: 'i12345', apiKey: 'key' });
      await useAuthStore.getState().clearCredentials();
      expect(useNotificationPreferences.getState().pendingUnregister).toBe(false);
      expect(unregisterPushToken).not.toHaveBeenCalled();
      jest.mocked(unregisterPushToken).mockResolvedValue(true);
    });
    it('deletes a queued offline key at sign-out', async () => {
      await useAuthStore.getState().clearCredentials();
      expect(mockDeleteItemAsync).toHaveBeenCalledWith(
        'intervals_pending_api_key',
        expect.anything()
      );
    });
    it('deletes all credentials from SecureStore', async () => {
      useAuthStore.setState({
        apiKey: 'some-key',
        accessToken: 'some-token',
        athleteId: 'i12345',
        isAuthenticated: true,
      });

      await useAuthStore.getState().clearCredentials();

      expect(mockDeleteItemAsync).toHaveBeenCalledWith(API_KEY_STORAGE_KEY, expect.anything());
      expect(mockDeleteItemAsync).toHaveBeenCalledWith(ATHLETE_ID_STORAGE_KEY, expect.anything());
      expect(mockDeleteItemAsync).toHaveBeenCalledWith(ACCESS_TOKEN_STORAGE_KEY, expect.anything());
    });

    it('resets all auth state', async () => {
      useAuthStore.setState({
        apiKey: 'key',
        accessToken: 'token',
        athleteId: 'id',
        athlete: { id: 'id', name: 'Test' },
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
      useAuthStore.setState({ athlete: { id: 'i123', name: 'Real User' } });

      useAuthStore.getState().enterDemoMode();

      expect(useAuthStore.getState().athlete).toBeNull();
    });

    it('exitDemoMode() resets to unauthenticated', async () => {
      useAuthStore.setState({
        isDemoMode: true,
        isAuthenticated: true,
        authMethod: 'demo',
        athleteId: DEMO_ATHLETE_ID,
        hideDemoBanner: true,
      });

      await useAuthStore.getState().exitDemoMode();
      expect(holdRecordingOnSignOut).toHaveBeenCalledWith(DEMO_ATHLETE_ID);

      const state = useAuthStore.getState();
      expect(state.isDemoMode).toBe(false);
      expect(state.isAuthenticated).toBe(false);
      expect(state.authMethod).toBeNull();
      expect(state.athleteId).toBeNull();
      expect(state.hideDemoBanner).toBe(false);
    });
  });

  describe('handleSessionExpired()', () => {
    describe('the push registration of a rejected session', () => {
      let alertSpy: jest.SpyInstance;
      beforeEach(() => {
        alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
      });
      afterEach(() => alertSpy.mockRestore());

      it('sends no unregister with the credential the server just rejected', async () => {
        useNotificationPreferences.setState({ enabled: true, privacyAccepted: true });
        useAuthStore.setState({ accessToken: 'dead', athleteId: 'i12345', authMethod: 'oauth' });
        await useAuthStore.getState().handleSessionExpired();
        expect(unregisterPushToken).not.toHaveBeenCalled();
      });
      it('clears a pending unregister that nothing can retry', async () => {
        useNotificationPreferences.setState({
          enabled: false,
          privacyAccepted: true,
          pendingUnregister: true,
          pendingUnregisterAthleteId: 'i12345',
        });
        useAuthStore.setState({ accessToken: 'dead', athleteId: 'i12345', authMethod: 'oauth' });
        await useAuthStore.getState().handleSessionExpired();
        const prefs = useNotificationPreferences.getState();
        expect(prefs.pendingUnregister).toBe(false);
        expect(prefs.pendingUnregisterAthleteId).toBeNull();
      });
      it('tells the athlete once that notifications may continue', async () => {
        useNotificationPreferences.setState({ enabled: true, privacyAccepted: true });
        useAuthStore.setState({ accessToken: 'dead', athleteId: 'i12345', authMethod: 'oauth' });
        await useAuthStore.getState().handleSessionExpired();
        expect(alertSpy).toHaveBeenCalledTimes(1);
      });
      it('says nothing when notifications were never on', async () => {
        useAuthStore.setState({ accessToken: 'dead', athleteId: 'i12345', authMethod: 'oauth' });
        await useAuthStore.getState().handleSessionExpired();
        expect(alertSpy).not.toHaveBeenCalled();
      });
      it('says nothing for an API-key session, which never registered a token', async () => {
        useNotificationPreferences.setState({ enabled: true, privacyAccepted: true });
        useAuthStore.setState({ apiKey: 'dead', athleteId: 'i12345', authMethod: 'apiKey' });
        await useAuthStore.getState().handleSessionExpired();
        expect(alertSpy).not.toHaveBeenCalled();
        expect(unregisterPushToken).not.toHaveBeenCalled();
      });
    });
    it("resets the previous athlete's upload permission and dismissed banner", async () => {
      useUploadPermissionStore.setState({
        hasWritePermission: true,
        isLoaded: true,
        bannerDismissed: true,
        recordingWithoutScope: true,
      });
      useAuthStore.setState({ accessToken: 'token', athleteId: 'i12345', authMethod: 'oauth' });
      await useAuthStore.getState().handleSessionExpired();
      const state = useUploadPermissionStore.getState();
      expect(state.hasWritePermission).toBeNull();
      expect(state.isLoaded).toBe(false);
      expect(state.bannerDismissed).toBe(false);
      expect(state.recordingWithoutScope).toBe(false);
    });
    it('leaves no upload permission for a relaunch to read back', async () => {
      useUploadPermissionStore.getState().setFromOAuthScope('ACTIVITY:WRITE');
      await waitFor(async () =>
        expect(await AsyncStorage.getItem('veloq-upload-permission')).not.toBeNull()
      );
      useAuthStore.setState({ accessToken: 'token', athleteId: 'i12345', authMethod: 'oauth' });
      await useAuthStore.getState().handleSessionExpired();
      useUploadPermissionStore.setState({ hasWritePermission: null, isLoaded: false });
      await waitFor(async () =>
        expect(await AsyncStorage.getItem('veloq-upload-permission')).toBeNull()
      );
      await useUploadPermissionStore.getState().initialize();
      expect(useUploadPermissionStore.getState().hasWritePermission).toBeNull();
    });
    it('clears OAuth credentials and sets session expired', async () => {
      useAuthStore.setState({
        accessToken: 'expired-token',
        athleteId: 'i12345',
        isAuthenticated: true,
        authMethod: 'oauth',
      });

      await useAuthStore.getState().handleSessionExpired();

      expect(mockDeleteItemAsync).toHaveBeenCalledWith(ACCESS_TOKEN_STORAGE_KEY, expect.anything());
      expect(mockDeleteItemAsync).toHaveBeenCalledWith(ATHLETE_ID_STORAGE_KEY, expect.anything());

      const state = useAuthStore.getState();
      expect(state.accessToken).toBeNull();
      expect(state.athleteId).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.authMethod).toBeNull();
      expect(state.sessionExpired).toBe('signed_out');
    });

    it('signs an API-key session out too, and words the reason for a key', async () => {
      useAuthStore.setState({
        apiKey: 'my-api-key',
        athleteId: 'i12345',
        isAuthenticated: true,
        authMethod: 'apiKey',
      });

      await useAuthStore.getState().handleSessionExpired();

      const state = useAuthStore.getState();
      expect(state.apiKey).toBeNull();
      expect(state.athleteId).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.authMethod).toBeNull();
      expect(state.sessionExpired).toBe('key_rejected');
    });

    // The login form has one field, the key itself, so deleting the stored key
    // here would leave the athlete nothing to paste. Only an explicit sign-out
    // deletes it.
    it('leaves the stored API key for the re-entry to prefill', async () => {
      useAuthStore.setState({
        apiKey: 'my-api-key',
        athleteId: 'i12345',
        isAuthenticated: true,
        authMethod: 'apiKey',
      });

      await useAuthStore.getState().handleSessionExpired();

      expect(mockDeleteItemAsync).not.toHaveBeenCalledWith(API_KEY_STORAGE_KEY, expect.anything());
      expect(mockDeleteItemAsync).toHaveBeenCalledWith(ATHLETE_ID_STORAGE_KEY, expect.anything());
    });

    // Both halves have to go or `initialize()` reads the pair back and signs
    // the same rejected key straight in again on the next launch.
    it('leaves a relaunch unauthenticated', async () => {
      useAuthStore.setState({
        apiKey: 'my-api-key',
        athleteId: 'i12345',
        isAuthenticated: true,
        authMethod: 'apiKey',
      });
      await useAuthStore.getState().handleSessionExpired();

      const deleted = new Set(mockDeleteItemAsync.mock.calls.map(([key]) => key));
      mockGetItemAsync.mockImplementation(async (key) => {
        if (deleted.has(key)) return null;
        if (key === API_KEY_STORAGE_KEY) return 'my-api-key';
        if (key === ATHLETE_ID_STORAGE_KEY) return 'i12345';
        return null;
      });

      await useAuthStore.getState().initialize();

      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });
  });

  // The stored key outlives a rejected session, so the re-entry has to be able
  // to say whose it is before it offers it back.
  describe('the stored key owner', () => {
    it('is recorded beside the key', async () => {
      await useAuthStore.getState().setCredentials('a-key', 'i12345');

      expect(mockSetItemAsync).toHaveBeenCalledWith(
        API_KEY_ATHLETE_STORAGE_KEY,
        'i12345',
        expect.anything()
      );
    });

    it('survives a 401, because the key does', async () => {
      useAuthStore.setState({ apiKey: 'a-key', athleteId: 'i12345', authMethod: 'apiKey' });

      await useAuthStore.getState().handleSessionExpired();

      expect(mockDeleteItemAsync).not.toHaveBeenCalledWith(
        API_KEY_ATHLETE_STORAGE_KEY,
        expect.anything()
      );
    });

    it('goes when an explicit sign-out takes the key', async () => {
      await useAuthStore.getState().clearCredentials();

      expect(mockDeleteItemAsync).toHaveBeenCalledWith(
        API_KEY_ATHLETE_STORAGE_KEY,
        expect.anything()
      );
    });

    it('goes when an OAuth sign-in takes the key', async () => {
      await useAuthStore.getState().setOAuthCredentials('token', 'i12345');

      expect(mockDeleteItemAsync).toHaveBeenCalledWith(
        API_KEY_ATHLETE_STORAGE_KEY,
        expect.anything()
      );
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
