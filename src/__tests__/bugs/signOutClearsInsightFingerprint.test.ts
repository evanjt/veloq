/**
 * Scenario: the insight fingerprint is the set of insight ids the athlete has
 * already been shown, and several of those ids are constants rather than being
 * keyed to anything the athlete owns: `hrv_trend`, `period_comparison-volume`,
 * `fitness_milestone-ftp`, `fitness_milestone-pace`,
 * `fitness_milestone-swim-pace` and `stale_pr-group`. The account wipe clears
 * the library, the profile and the caches and leaves the fingerprint.
 *
 * Expected behaviour: the wipe clears it too, so the next athlete's constant-id
 * insights are new to them.
 */

import { clearAccountData } from '@/shared/storage';
import { getSetting, setSetting } from '@/shared/storage/settingsStorage';
import {
  readInsightFingerprint,
  writeInsightFingerprint,
} from '@/features/insights/lib/fingerprintStore';
import { useInsightsStore } from '@/features/insights/store';
import { useNotificationPreferences } from '@/features/settings/stores/NotificationPreferencesStore';
import { getWebdavConfig, setWebdavConfig } from '@/features/settings/lib/autobackup/webdavConfig';
import { isAutoBackupEnabled } from '@/features/settings/lib/autobackup/autoBackup';
import { getEngine, isEngineReady } from '@/shared/native/engine';
import { useAuthStore } from '@/shared/app/AuthStore';
import { registerPushToken } from '@/features/settings/lib/pushTokenRegistration';
import * as SecureStore from 'expo-secure-store';
import { readPendingApiKey, savePendingApiKey } from '@/features/auth/lib/pendingSignIn';
import { accountChangeAction, getCachedAthleteId } from '@/features/auth/lib/accountChange';
import { demoEntryAction } from '@/features/auth/lib/storedActivityCount';
import {
  readCachedAthleteIdMirror,
  rememberCachedAthleteId,
} from '@/shared/storage/cachedAthleteId';

const mockSettings = new Map<string, string>();
const mockAsyncStorage = new Map<string, string>();

jest.mock('@/shared/storage/settingsStorage', () => ({
  getSetting: jest.fn(async (key: string) => mockSettings.get(key) ?? null),
  setSetting: jest.fn(async (key: string, value: string) => {
    mockSettings.set(key, value);
  }),
  removeSetting: jest.fn(async (key: string) => {
    mockSettings.delete(key);
  }),
}));

jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  documentDirectory: '/mock/docs/',
  getInfoAsync: jest.fn(async () => ({ exists: false, isDirectory: false })),
  makeDirectoryAsync: jest.fn(async () => {}),
  writeAsStringAsync: jest.fn(async () => {}),
  readAsStringAsync: jest.fn(async () => {
    throw new Error('File not found');
  }),
  deleteAsync: jest.fn(async () => {}),
  readDirectoryAsync: jest.fn(async () => []),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    removeItem: jest.fn(async (key: string) => {
      mockAsyncStorage.delete(key);
    }),
    getItem: jest.fn(async (key: string) => mockAsyncStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockAsyncStorage.set(key, value);
    }),
  },
}));

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(() => null),
  getRouteDbPath: jest.fn(() => '/mock/docs/routes.db'),
  isEngineReady: jest.fn(() => false),
}));

jest.mock('@/features/settings/lib/pushTokenRegistration', () => ({
  registerPushToken: jest.fn(async () => true),
  unregisterPushToken: jest.fn(async () => true),
}));

beforeEach(() => {
  mockSettings.clear();
  mockAsyncStorage.clear();
  (getEngine as jest.Mock).mockReturnValue(null);
  jest.mocked(isEngineReady).mockReturnValue(false);
  jest.mocked(registerPushToken).mockClear();
});

describe('an account wipe and the insights the next athlete has never seen', () => {
  it('forgets the fingerprint the previous athlete left', async () => {
    await writeInsightFingerprint('fitness_milestone-ftp|hrv_trend|period_comparison-volume');
    expect(await readInsightFingerprint()).not.toBe('');

    await clearAccountData({ clear: () => {} });

    expect(await readInsightFingerprint()).toBe('');
  });

  it('forgets the in-memory insight state on account deletion', async () => {
    useInsightsStore.setState({
      lastSeenFingerprint: 'hrv_trend',
      hasNewInsights: true,
    });
    await clearAccountData({ clear: () => {} });
    expect(useInsightsStore.getState().lastSeenFingerprint).toBe('');
    expect(useInsightsStore.getState().hasNewInsights).toBe(false);
  });

  it('deletes the record archive the device backup would carry', async () => {
    const FileSystem = jest.requireMock('expo-file-system/legacy');
    await clearAccountData({ clear: () => {} });
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith('/mock/docs/veloq-decisions.zip', {
      idempotent: true,
    });
  });

  it("deletes the previous athlete's local backups", async () => {
    const FileSystem = jest.requireMock('expo-file-system/legacy');
    await clearAccountData({ clear: () => {} });
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith('/mock/docs/backups/', {
      idempotent: true,
    });
  });

  it("removes the previous athlete's WebDAV credentials", async () => {
    await setWebdavConfig('https://example.com/dav', 'athlete-a', 'secret');
    expect(getWebdavConfig()?.username).toBe('athlete-a');
    await clearAccountData({ clear: () => {} });
    expect(getWebdavConfig()).toBeNull();
    for (const key of [
      'veloq-webdav-url',
      'veloq-webdav-username',
      'veloq-webdav-password',
      'veloq-webdav-plain-lan',
    ]) {
      expect(await SecureStore.getItemAsync(key)).toBeNull();
    }
  });

  it('deletes a key queued offline, so a reconnect cannot sign its owner in', async () => {
    const keychain = new Map<string, string>();
    jest.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => {
      keychain.set(key, value);
    });
    jest
      .mocked(SecureStore.getItemAsync)
      .mockImplementation(async (key) => keychain.get(key) ?? null);
    jest.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => {
      keychain.delete(key);
    });
    await savePendingApiKey('queued-key');
    expect(await readPendingApiKey()).toBe('queued-key');

    await clearAccountData({ clear: () => {} });

    expect(await readPendingApiKey()).toBeNull();
    jest.mocked(SecureStore.setItemAsync).mockResolvedValue(undefined);
    jest.mocked(SecureStore.getItemAsync).mockResolvedValue(null);
    jest.mocked(SecureStore.deleteItemAsync).mockResolvedValue(undefined);
  });

  it('leaves backup unconfigured after deleting the account', async () => {
    const engineSettings = new Map([
      ['__backup_backend', 'webdav'],
      ['__auto_backup_enabled', '1'],
    ]);
    (getEngine as jest.Mock).mockReturnValue({
      clear: jest.fn(async () => {}),
      getSetting: (key: string) => engineSettings.get(key) ?? null,
      setSetting: (key: string, value: string) => engineSettings.set(key, value),
      deleteSetting: (key: string) => engineSettings.delete(key),
    });
    try {
      await clearAccountData({ clear: () => {} });
      expect(engineSettings.has('__backup_backend')).toBe(false);
      expect(isAutoBackupEnabled()).toBe(false);
    } finally {
      (getEngine as jest.Mock).mockReturnValue(null);
    }
  });

  it('resets consent while keeping an owed unregister', async () => {
    useNotificationPreferences.setState({
      enabled: true,
      privacyAccepted: true,
      pendingUnregister: true,
      pendingUnregisterAthleteId: 'athlete-a',
    });
    await clearAccountData({ clear: () => {} });
    const state = useNotificationPreferences.getState();
    expect(state.enabled).toBe(false);
    expect(state.privacyAccepted).toBe(false);
    expect(state.pendingUnregister).toBe(true);
    expect(state.pendingUnregisterAthleteId).toBe('athlete-a');
  });

  it('does not register the next athlete without their consent', async () => {
    useNotificationPreferences.setState({ enabled: true, privacyAccepted: true });
    await clearAccountData({ clear: () => {} });
    await useAuthStore.getState().setOAuthCredentials('token-b', 'athlete-b');
    expect(registerPushToken).not.toHaveBeenCalled();
    expect(useNotificationPreferences.getState().privacyAccepted).toBe(false);
  });

  it('leaves no account change prompt after deleting an open library', async () => {
    const engineSettings = new Map([['__athlete_id', 'athlete-a']]);
    let count = 24;
    const engine = {
      clear: jest.fn(async () => {
        engineSettings.delete('__athlete_id');
        count = 0;
      }),
      getAthleteProfile: () => null,
      getActivityCount: () => 0,
      getStats: () => ({ activityCount: 0, libraryCount: count }),
      getSetting: (key: string) => engineSettings.get(key) ?? null,
      setSetting: (key: string, value: string) => engineSettings.set(key, value),
      deleteSetting: (key: string) => engineSettings.delete(key),
    };
    (getEngine as jest.Mock).mockReturnValue(engine);
    jest.mocked(isEngineReady).mockReturnValue(true);
    await rememberCachedAthleteId('athlete-a');

    await clearAccountData({ clear: () => {} });

    expect(engine.clear).toHaveBeenCalled();
    expect(await readCachedAthleteIdMirror()).toBeNull();
    expect(await demoEntryAction()).toBe('keep');
    expect(accountChangeAction(await getCachedAthleteId(), 'athlete-b')).toBe('keep');
    jest.mocked(isEngineReady).mockReturnValue(false);
    expect(await demoEntryAction()).toBe('keep');
    expect(accountChangeAction(await getCachedAthleteId(), 'athlete-b')).toBe('keep');
  });

  it('forgets the notified set an earlier release left on the device', async () => {
    await setSetting('veloq-insights-notified-fingerprint', 'fitness_milestone-ftp|hrv_trend');

    await clearAccountData({ clear: () => {} });

    expect(await getSetting('veloq-insights-notified-fingerprint')).toBeNull();
  });
});
