/**
 * Scenario: an athlete with no intervals.icu account signs in with a Garmin
 * key. The keychain then holds the key and the library identity
 * `garmin:<id>`, and nothing from intervals.icu.
 *
 * Expected behaviour: the next launch reads that as a signed-in session, an
 * intervals.icu sign-in or sign-out never deletes the key, and signing out of
 * a Garmin-only session disconnects Garmin so the device is signed out.
 */

import * as SecureStore from 'expo-secure-store';

import { useAuthStore } from '@/shared/app/AuthStore';
import { GARMIN_KEY_STORAGE_KEY } from '@/shared/app/credentialKeychain';

const mockEngine = { setSyncCredentials: jest.fn(), clearSyncCredentials: jest.fn() };
const mockDisconnect = jest.fn(async () => {});

jest.mock('@/shared/native/engine', () => ({ getEngine: () => mockEngine }));
jest.mock('@/features/settings/lib/garminConnector', () => ({
  disconnectGarmin: () => mockDisconnect(),
}));
jest.mock('@/features/recording', () => ({
  holdRecordingOnSignOut: jest.fn(async () => {}),
  holdRecordingsOfOtherAthletes: jest.fn(async () => {}),
  useUploadPermissionStore: { getState: () => ({ reset: jest.fn() }) },
}));
jest.mock('@/features/auth/lib/pendingSignIn', () => ({
  clearPendingApiKey: jest.fn(async () => {}),
}));
jest.mock('@/features/settings/stores/NotificationPreferencesStore', () => ({
  getNotificationPreferences: () => ({ enabled: false }),
  resolvePendingUnregisterAthleteId: () => null,
  useNotificationPreferences: { getState: () => ({ disableForApiKey: jest.fn() }) },
}));

const keychain = new Map<string, string>();

beforeEach(() => {
  keychain.clear();
  mockDisconnect.mockClear();
  (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (key: string) => {
    return keychain.get(key) ?? null;
  });
  (SecureStore.setItemAsync as jest.Mock).mockImplementation(async (key: string, value: string) => {
    keychain.set(key, value);
  });
  (SecureStore.deleteItemAsync as jest.Mock).mockImplementation(async (key: string) => {
    keychain.delete(key);
  });
  useAuthStore.setState({
    apiKey: null,
    accessToken: null,
    athleteId: null,
    athlete: null,
    isAuthenticated: false,
    isDemoMode: false,
    authMethod: null,
    isLoading: true,
    sessionExpired: null,
  });
});

describe('launch with a Garmin key', () => {
  it('signs the Garmin identity in when no intervals.icu credential is stored', async () => {
    keychain.set('intervals_athlete_id', 'garmin:8841');
    keychain.set(GARMIN_KEY_STORAGE_KEY, 'pasted-key');

    await useAuthStore.getState().initialise();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.authMethod).toBe('garmin');
    expect(state.athleteId).toBe('garmin:8841');
    expect(state.sessionExpired).toBeNull();
  });

  it('signs nobody in on a key left behind by an intervals.icu sign-out', async () => {
    keychain.set(GARMIN_KEY_STORAGE_KEY, 'pasted-key');

    await useAuthStore.getState().initialise();

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().authMethod).toBeNull();
  });

  it('keeps the intervals.icu session when a key sits beside its credential', async () => {
    keychain.set('intervals_api_key', 'icu-key');
    keychain.set('intervals_athlete_id', 'i77');
    keychain.set(GARMIN_KEY_STORAGE_KEY, 'pasted-key');

    await useAuthStore.getState().initialise();

    expect(useAuthStore.getState().authMethod).toBe('apiKey');
    expect(useAuthStore.getState().athleteId).toBe('i77');
  });
});

describe('signing in with a Garmin key', () => {
  it('keeps the key and the identity, and drops any intervals.icu credential', async () => {
    keychain.set('intervals_api_key', 'icu-key');
    keychain.set('intervals_api_key_athlete_id', 'i77');
    keychain.set('intervals_access_token', 'token');

    await useAuthStore.getState().setGarminCredentials('pasted-key', '8841');

    expect(keychain.get(GARMIN_KEY_STORAGE_KEY)).toBe('pasted-key');
    expect(keychain.get('intervals_athlete_id')).toBe('garmin:8841');
    expect(keychain.has('intervals_api_key')).toBe(false);
    expect(keychain.has('intervals_api_key_athlete_id')).toBe(false);
    expect(keychain.has('intervals_access_token')).toBe(false);
    const state = useAuthStore.getState();
    expect([state.isAuthenticated, state.authMethod, state.athleteId]).toEqual([
      true,
      'garmin',
      'garmin:8841',
    ]);
  });

  it('refuses a blank key or account id and writes nothing', async () => {
    await useAuthStore.getState().setGarminCredentials('  ', '8841');
    await useAuthStore.getState().setGarminCredentials('pasted-key', ' ');
    expect(keychain.size).toBe(0);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
});

describe('the Garmin key and the intervals.icu credential', () => {
  it('survives an API-key sign-in', async () => {
    keychain.set(GARMIN_KEY_STORAGE_KEY, 'pasted-key');

    await useAuthStore.getState().setCredentials('icu-key', 'i77');

    expect(keychain.get(GARMIN_KEY_STORAGE_KEY)).toBe('pasted-key');
  });

  it('survives an intervals.icu sign-out, which disconnects nothing', async () => {
    keychain.set(GARMIN_KEY_STORAGE_KEY, 'pasted-key');
    await useAuthStore.getState().setCredentials('icu-key', 'i77');

    await useAuthStore.getState().clearCredentials();

    expect(keychain.get(GARMIN_KEY_STORAGE_KEY)).toBe('pasted-key');
    expect(mockDisconnect).not.toHaveBeenCalled();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('is disconnected by signing out of a Garmin-only session, so a sign-out signs out', async () => {
    await useAuthStore.getState().setGarminCredentials('pasted-key', '8841');

    await useAuthStore.getState().clearCredentials();

    expect(mockDisconnect).toHaveBeenCalledTimes(1);
    expect(keychain.has('intervals_athlete_id')).toBe(false);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().authMethod).toBeNull();
  });

  it('is not signed out by a rejected key, which is not an intervals.icu 401', async () => {
    await useAuthStore.getState().setGarminCredentials('pasted-key', '8841');

    await useAuthStore.getState().handleSessionExpired();

    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().sessionExpired).toBeNull();
    expect(keychain.get(GARMIN_KEY_STORAGE_KEY)).toBe('pasted-key');
  });
});
