/**
 * Scenario: a fresh install restores a backup from the login screen, where
 * the engine holds a library but the app holds no credentials.
 *
 * Expected behaviour: the restore records whose data it just put on the
 * device, and the two screens that wipe a library ask first. Without the
 * stamp the mirror stays empty, every identity check answers "nothing
 * cached", and the next tap destroys the restored library in silence.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';

import { restoreDatabaseBackup } from '@/features/settings/lib/backup';
import { accountChangeAction, promptAccountMismatch } from '@/features/auth/lib/accountChange';
import { readCachedAthleteIdMirror } from '@/shared/storage/cachedAthleteId';
import * as FileSystem from 'expo-file-system/legacy';

const mockEngine = {
  destroyEngine: jest.fn(),
  getActivityCount: jest.fn().mockReturnValue(80),
  notifyAll: jest.fn(),
  getSetting: jest.fn().mockReturnValue(null),
  setSetting: jest.fn(),
  clear: jest.fn(),
};

const mockNativeModule = {
  validateBackupDatabase: jest.fn(),
  engine: { initWithPath: jest.fn().mockReturnValue(true) },
};

let mockAthleteId: string | null = null;
const mockClearCredentials = jest.fn();

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockEngine,
  getRouteDbPath: () => '/data/veloq.db',
  getNativeModule: () => mockNativeModule,
  isEngineReady: () => true,
}));

jest.mock('@/shared/app/AuthStore', () => ({
  DEMO_ATHLETE_ID: 'demo',
  useAuthStore: {
    getState: () => ({ athleteId: mockAthleteId, clearCredentials: mockClearCredentials }),
  },
}));

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  getInfoAsync: jest.fn().mockResolvedValue({ exists: true, size: 1024 }),
  copyAsync: jest.fn().mockResolvedValue(undefined),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
  readDirectoryAsync: jest.fn().mockResolvedValue([]),
}));

jest.mock('@/shared/query/QueryProvider', () => ({
  queryClient: { invalidateQueries: jest.fn() },
}));

jest.mock('@/features/settings/lib/shareFile', () => ({
  shareFile: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/features/routes/lib/elevationBackfillTrigger', () => ({
  startElevationBackfillAfterUpdate: jest.fn().mockResolvedValue(false),
}));

jest.mock('@/features/routes/lib/cutoverTrigger', () => ({
  startDetectorCutoverAfterUpdate: jest.fn().mockResolvedValue(false),
}));

jest.mock('@/shared/app/ThemeProvider', () => ({
  initializeTheme: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/shared/app/LanguageStore', () => ({
  initializeLanguage: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/shared/app/UnitPreferenceStore', () => ({
  initializeUnitPreference: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/fitness/stores', () => ({
  initializeSportPreference: jest.fn().mockResolvedValue(undefined),
  initializeHRZones: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/home/store', () => ({
  initializeDashboardPreferences: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/insights/store', () => ({
  initializeInsightsStore: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/maps/lib/storage/tileCacheSettings', () => ({
  migrateTileCacheSettings: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/recording/stores/RecordingPreferencesStore', () => ({
  initializeRecordingPreferences: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/routes/stores/RouteSettingsStore', () => ({
  initializeRouteSettings: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/settings/stores/DebugStore', () => ({
  initializeDebugStore: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/settings/stores/NotificationPreferencesStore', () => ({
  initializeNotificationPreferences: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/settings/stores/NotificationPromptStore', () => ({
  initializeNotificationPrompt: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/shared/app/SupportStore', () => ({
  initializeSupportStore: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/settings/stores/WhatsNewStore', () => ({
  initializeWhatsNewStore: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/maps/lib/storage/mapCameraState', () => ({
  reloadMapCameraState: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/features/maps/lib/storage/terrainCameraOverrides', () => ({
  reloadCameraOverrides: jest.fn().mockResolvedValue(undefined),
}));

const BACKUP_META = JSON.stringify({
  schema_version: '12',
  athlete_id: 'athlete-9',
  activity_count: 80,
});

async function restoreWhileSignedOut() {
  mockNativeModule.validateBackupDatabase.mockImplementation((path: string) => {
    if (path.includes('veloq.db')) throw new Error('fresh install');
    return BACKUP_META;
  });
  return restoreDatabaseBackup('file:///in/backup.veloqdb');
}

beforeEach(async () => {
  mockAthleteId = null;
  mockClearCredentials.mockReset();
  mockEngine.setSetting.mockReset();
  mockEngine.clear.mockReset();
  mockEngine.getActivityCount.mockReset().mockReturnValue(80);
  mockEngine.getSetting.mockReset().mockReturnValue(null);
  mockNativeModule.engine.initWithPath.mockReset().mockReturnValue(true);
  (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: true, size: 1024 });
  (FileSystem.readDirectoryAsync as jest.Mock).mockReset().mockResolvedValue([]);
  await AsyncStorage.clear();
});

describe('a restore performed while signed out', () => {
  it('records the backup athlete in the engine and the mirror', async () => {
    const result = await restoreWhileSignedOut();

    expect(result.success).toBe(true);
    expect(mockEngine.setSetting).toHaveBeenCalledWith('__athlete_id', 'athlete-9');
    await expect(readCachedAthleteIdMirror()).resolves.toBe('athlete-9');
  });

  it('leaves the stamp alone when the backup names no athlete', async () => {
    mockNativeModule.validateBackupDatabase.mockImplementation((path: string) => {
      if (path.includes('veloq.db')) throw new Error('fresh install');
      return JSON.stringify({ schema_version: '12', athlete_id: null, activity_count: 80 });
    });

    const result = await restoreDatabaseBackup('file:///in/backup.veloqdb');

    expect(result.success).toBe(true);
    expect(mockEngine.setSetting).not.toHaveBeenCalledWith('__athlete_id', expect.anything());
    await expect(readCachedAthleteIdMirror()).resolves.toBeNull();
  });

  it('does not stamp anything when the restore is refused', async () => {
    mockNativeModule.validateBackupDatabase.mockImplementation(() =>
      JSON.stringify({ schema_version: '12', athlete_id: 'athlete-9', activity_count: 0 })
    );

    const result = await restoreDatabaseBackup('file:///in/backup.veloqdb');

    expect(result.success).toBe(false);
    expect(mockEngine.setSetting).not.toHaveBeenCalled();
    await expect(readCachedAthleteIdMirror()).resolves.toBeNull();
  });
});

describe('a library nothing has named', () => {
  it('is confirmed before a wipe, on the count alone', () => {
    expect(accountChangeAction(null, 'demo', 80)).toBe('confirm-then-wipe');
  });

  it('is kept silently when there is nothing on the device', () => {
    expect(accountChangeAction(null, 'demo', 0)).toBe('keep');
  });

  it('does not ask when the incoming athlete is the cached one', () => {
    expect(accountChangeAction('athlete-9', 'athlete-9', 80)).toBe('keep');
  });

  it('still wipes leftover demo fixtures without asking', () => {
    expect(accountChangeAction('demo', 'athlete-9', 80)).toBe('wipe');
  });
});

describe('the restored-identity prompt', () => {
  function press(label: 'cancel' | 'destructive') {
    (Alert.alert as jest.Mock).mockImplementation((_t, _m, buttons) => {
      const button = buttons.find((b: { style?: string }) =>
        label === 'cancel' ? b.style === 'cancel' : b.style === 'destructive'
      );
      button.onPress();
    });
  }

  beforeEach(() => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  it('clears nothing until the athlete accepts', async () => {
    press('cancel');

    const cleared = await promptAccountMismatch({
      storedAthleteId: 'athlete-9',
      credentialsAthleteId: 'athlete-1',
    });

    expect(cleared).toBe(false);
    expect(mockEngine.clear).not.toHaveBeenCalled();
    expect(mockClearCredentials).toHaveBeenCalled();
  });

  it('clears and re-stamps once the athlete accepts', async () => {
    press('destructive');

    const cleared = await promptAccountMismatch({
      storedAthleteId: 'athlete-9',
      credentialsAthleteId: 'athlete-1',
    });

    expect(cleared).toBe(true);
    expect(mockEngine.clear).toHaveBeenCalled();
    expect(mockEngine.setSetting).toHaveBeenCalledWith('__athlete_id', 'athlete-1');
    await expect(readCachedAthleteIdMirror()).resolves.toBe('athlete-1');
  });
});
