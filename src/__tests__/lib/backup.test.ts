/**
 * Tests for backup/restore functionality.
 *
 * Covers: restoreBackup, restoreDatabaseBackup
 * Bug fixes validated:
 * - version === undefined conflated with version > BACKUP_VERSION
 * - Missing startIndex < endIndex validation
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';

import {
  SignInRequiredError,
  checkRecordBackup,
  convertLegacyBackupToRecord,
  discardRecordImport,
  exportRecordBackup,
  restoreRecordBackup,
  restoreBackup,
  restoreDatabaseBackup,
  resumeRecordImport,
} from '@/features/settings/lib/backup';
import { i18n } from '@/i18n';
import * as FileSystem from 'expo-file-system/legacy';
import { getSetting, setSetting, removeSetting } from '@/shared/storage';
import { shareExistingFile } from '@/features/settings/lib/shareFile';
import { initializeUnitPreference } from '@/shared/app/UnitPreferenceStore';

// The maps barrel reaches the engine binding, which registers a TurboModule at
// import time, so the graph this renders cannot load without the stub.
jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
// Mock the route engine
const mockEngine = {
  getSectionsByType: jest.fn().mockReturnValue([]),
  getAllSectionNames: jest.fn().mockReturnValue({}),
  getAllRouteNames: jest.fn().mockReturnValue({}),
  // Coordinate-encoded; the `decodeCoords` mock above reads the points back out.
  getGpsTrack: jest.fn().mockReturnValue({ points: [] }),
  createSectionFromIndices: jest.fn().mockReturnValue('section-1'),
  setSectionName: jest.fn(),
  setRouteName: jest.fn(),
  deleteSection: jest.fn(),
  destroyEngine: jest.fn(),
  getActivityCount: jest.fn().mockReturnValue(0),
  getStats: jest.fn().mockReturnValue({ activityCount: 0, libraryCount: 100 }),
  clearRecordings: jest.fn(),
  notifyAll: jest.fn(),
  getSetting: jest.fn().mockReturnValue(null),
  setSetting: jest.fn(),
  getBackupMetadata: jest.fn().mockReturnValue({ newest_date: 1_760_000_000 }),
  runRecordBackup: jest.fn().mockResolvedValue(undefined),
  checkRecordZip: jest.fn().mockResolvedValue(undefined),
  restoreRecordZip: jest.fn().mockResolvedValue({ placed: 2, unplaced: 1, missingActivityIds: [] }),
  restoreRecordJson: jest
    .fn()
    .mockResolvedValue({ placed: 2, unplaced: 1, missingActivityIds: [] }),
  getUnplacedBackupRecords: jest.fn().mockResolvedValue([]),
  discardRecordImport: jest.fn().mockResolvedValue(undefined),
  syncNow: jest.fn().mockReturnValue(0),
};
const mockEngineState = { ready: true };

const mockNativeModule = {
  validateBackupDatabase: jest.fn(),
  convertLegacyDatabaseToRecordBackup: jest.fn().mockResolvedValue(undefined),
  engine: { initWithPath: jest.fn() },
};

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    decodeCoords: (buf: ArrayBuffer) =>
      (buf as unknown as { points?: { latitude: number; longitude: number }[] }).points ?? [],
  })
);
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockEngine,
  getRouteDbPath: () => '/data/veloq.db',
  getNativeModule: () => mockNativeModule,
  isEngineReady: () => mockEngineState.ready,
}));

jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  cacheDirectory: 'file:///cache/',
  documentDirectory: 'file:///documents/',
  getInfoAsync: jest.fn().mockResolvedValue({ exists: true, size: 1024 }),
  copyAsync: jest.fn().mockResolvedValue(undefined),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
  readDirectoryAsync: jest.fn().mockResolvedValue([]),
}));

jest.mock('@/shared/query/QueryProvider', () => ({
  queryClient: { invalidateQueries: jest.fn() },
}));

jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: { getState: () => ({ athleteId: 'athlete-1' }) },
}));

jest.mock('@/features/settings/lib/shareFile', () => ({
  shareFile: jest.fn().mockResolvedValue(undefined),
  shareExistingFile: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/shared/storage/databaseStamps', () => ({
  DATABASE_LOCAL_STAMPS: ['terrain-preview-cache-version'],
  clearDatabaseStamps: jest.fn().mockResolvedValue(undefined),
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
}));
jest.mock('@/features/home/store', () => ({
  initializeDashboardPreferences: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/insights/store', () => ({
  initializeInsightsStore: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/maps/lib/storage/tileCacheSettings', () => ({
  initializeTileCacheSettings: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/recording/stores/RecordingPreferencesStore', () => ({
  initializeRecordingPreferences: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/settings/stores/DebugStore', () => ({
  initializeDebugStore: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/settings/stores/NotificationPreferencesStore', () => ({
  initializeNotificationPreferences: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/settings/stores/NotificationPromptStore', () => ({
  initializeNotificationPrompt: jest.fn().mockResolvedValue(undefined),
  useNotificationPrompt: { getState: () => ({ reset: jest.fn() }) },
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

jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn().mockImplementation((key: string) => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    return AsyncStorage.getItem(key);
  }),
  setSetting: jest.fn().mockImplementation(async (key: string, value: string) => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.setItem(key, value);
  }),
  removeSetting: jest.fn().mockResolvedValue(undefined),
  rememberStoredActivityCount: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/features/maps/lib/storage/terrainCameraOverrides', () => ({
  reloadCameraOverrides: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-constants', () => ({
  ...jest.requireActual('expo-constants'),
  __esModule: true,
  default: { expoConfig: { version: '0.3.0' } },
}));

function makeValidBackup(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 2,
    exportedAt: '2026-01-01T00:00:00.000Z',
    appVersion: '0.3.0',
    customSections: [],
    sectionNames: {},
    routeNames: {},
    preferences: {},
    ...overrides,
  });
}

const mockSettings = new Map<string, string>();

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  mockSettings.clear();
  mockEngineState.ready = true;
  mockEngine.getActivityCount.mockReturnValue(0);
  mockEngine.getStats.mockReturnValue({ activityCount: 0, libraryCount: 100 });
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _body, buttons) => {
    buttons?.find((button) => button.style === 'destructive')?.onPress?.();
  });
  // Reset engine mocks to defaults
  mockEngine.getSectionsByType.mockReturnValue([]);
  mockEngine.getAllSectionNames.mockReturnValue({});
  mockEngine.getAllRouteNames.mockReturnValue({});
  mockEngine.getGpsTrack.mockReturnValue({ points: [] });
  mockEngine.getSetting.mockReturnValue(null);
  mockEngine.createSectionFromIndices.mockReturnValue('section-1');
  mockEngine.setSectionName.mockImplementation(() => {});
  mockEngine.setRouteName.mockImplementation(() => {});
  mockEngine.setSectionName.mockClear();
  mockEngine.setRouteName.mockClear();
  mockEngine.syncNow.mockReset().mockReturnValue(0);
  (AsyncStorage.getItem as jest.Mock).mockImplementation(
    async (key: string) => mockSettings.get(key) ?? null
  );
  (AsyncStorage.setItem as jest.Mock).mockImplementation(async (key: string, value: string) => {
    mockSettings.set(key, value);
  });
  (getSetting as jest.Mock).mockImplementation(
    async (key: string) => mockSettings.get(key) ?? null
  );
  (setSetting as jest.Mock).mockImplementation(async (key: string, value: string) => {
    await AsyncStorage.setItem(key, value);
  });
  (removeSetting as jest.Mock).mockResolvedValue(undefined);
  (FileSystem.getInfoAsync as jest.Mock)
    .mockReset()
    .mockResolvedValue({ exists: true, size: 1024 });
});

describe('record backup export', () => {
  it('shares the deflated record zip written by the engine', async () => {
    await exportRecordBackup();

    const path = mockEngine.runRecordBackup.mock.calls[0][0] as string;
    expect(path).toMatch(/^\/cache\/.*\.zip$/);
    expect(shareExistingFile).toHaveBeenCalledWith(`file://${path}`, 'application/zip');
  });

  it('does not share a failed write, and a second tap can retry', async () => {
    mockEngine.runRecordBackup.mockRejectedValueOnce(new Error('disk full'));
    await expect(exportRecordBackup()).rejects.toThrow('disk full');
    expect(shareExistingFile).not.toHaveBeenCalled();

    await exportRecordBackup();
    expect(mockEngine.runRecordBackup).toHaveBeenCalledTimes(2);
    expect(shareExistingFile).toHaveBeenCalledTimes(1);
  });
});

describe('record backup import', () => {
  it('mirrors restored preferences for the next signed-out launch', async () => {
    mockEngine.getSetting.mockImplementation((key: string) =>
      key === 'veloq-theme-preference' ? 'dark' : undefined
    );
    await restoreRecordBackup('content://picked/backup.zip');
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('veloq-theme-preference', 'dark');
  });

  it('hands owed source activities to a sync rather than holding the import on them', async () => {
    mockEngine.restoreRecordZip.mockResolvedValueOnce({
      placed: 2,
      unplaced: 1,
      missingActivityIds: ['old-ride'],
    });

    const result = await restoreRecordBackup('content://picked/backup.zip');

    expect(mockEngine.syncNow).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ placed: 2, unplaced: 1, missingActivityIds: ['old-ride'] });
  });

  it('starts no sync when the record owes no activity', async () => {
    await restoreRecordBackup('content://picked/backup.zip');

    expect(mockEngine.syncNow).not.toHaveBeenCalled();
  });

  it('keeps the import when a sync cannot start, since the next sync resumes the fetch', async () => {
    mockEngine.restoreRecordZip.mockResolvedValueOnce({
      placed: 0,
      unplaced: 1,
      missingActivityIds: ['old-ride'],
    });
    mockEngine.syncNow.mockImplementationOnce(() => {
      throw new Error('Credentials unavailable');
    });

    await expect(restoreRecordBackup('content://picked/backup.zip')).resolves.toEqual({
      placed: 0,
      unplaced: 1,
      missingActivityIds: ['old-ride'],
    });
  });

  it('copies a picked zip before restoring and removes the temporary copy', async () => {
    const result = await restoreRecordBackup('content://picked/backup.zip');

    const destination = (FileSystem.copyAsync as jest.Mock).mock.calls[0][0].to as string;
    expect(destination).toMatch(/^file:\/\/\/cache\/.*\.zip$/);
    expect(mockEngine.restoreRecordZip).toHaveBeenCalledWith(destination.slice(7));
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(destination, { idempotent: true });
    expect(result).toMatchObject({ placed: 2, unplaced: 1 });
  });

  it('refuses an empty file before the engine writes anything', async () => {
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValueOnce({ exists: true, size: 0 });

    await expect(restoreRecordBackup('content://picked/empty.zip')).rejects.toThrow('empty');
    expect(mockEngine.restoreRecordZip).not.toHaveBeenCalled();
  });

  it('cleans up after a failed validation and permits a second import', async () => {
    mockEngine.restoreRecordZip.mockRejectedValueOnce(new Error('newer version'));
    await expect(restoreRecordBackup('content://picked/new.zip')).rejects.toThrow('newer version');
    expect(FileSystem.deleteAsync).toHaveBeenCalledTimes(1);

    await expect(restoreRecordBackup('content://picked/good.zip')).resolves.toMatchObject({
      placed: 2,
    });
    expect(mockEngine.restoreRecordZip).toHaveBeenCalledTimes(2);
  });
});

describe('legacy database conversion', () => {
  it('restores decisions through the record path without replacing the live library', async () => {
    const result = await restoreDatabaseBackup('content://picked/old.veloqdb');

    expect(mockNativeModule.convertLegacyDatabaseToRecordBackup).toHaveBeenCalledTimes(1);
    expect(mockEngine.restoreRecordZip).toHaveBeenCalledTimes(1);
    expect(mockEngine.destroyEngine).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, activityCount: 100, unplacedCount: 1 });
  });

  it('names an empty or missing file by reason, not by an English sentence', async () => {
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValueOnce({ exists: true, size: 0 });

    const result = await restoreDatabaseBackup('content://picked/empty.veloqdb');

    expect(result).toMatchObject({ success: false, reason: 'missing' });
    expect(result.error).toBeUndefined();
    expect(mockNativeModule.convertLegacyDatabaseToRecordBackup).not.toHaveBeenCalled();
  });

  it('reports the converted record account mismatch without replacing the library', async () => {
    mockEngine.restoreRecordZip.mockRejectedValueOnce(
      new Error('Record belongs to another athlete')
    );

    const result = await restoreDatabaseBackup('content://picked/other.veloqdb');

    expect(result).toMatchObject({ success: false, athleteIdMismatch: true });
    expect(mockEngine.destroyEngine).not.toHaveBeenCalled();
  });
});

describe('legacy JSON record import', () => {
  it('asks a sync for a custom section source outside the sync window', async () => {
    mockEngine.restoreRecordJson.mockResolvedValueOnce({
      placed: 0,
      unplaced: 1,
      missingActivityIds: ['old-ride'],
    });

    const result = await restoreBackup(
      makeValidBackup({
        customSections: [
          {
            name: 'Hill',
            sportType: 'Ride',
            sourceActivityId: 'old-ride',
            startIndex: 2,
            endIndex: 8,
          },
        ],
      })
    );

    expect(mockEngine.syncNow).toHaveBeenCalledTimes(1);
    expect(result.unplacedCount).toBe(1);
  });

  it.each([1, 2])('routes readable version %i through record restore', async (version) => {
    const json = makeValidBackup({
      version,
      customSections: [
        { name: 'Hill', sportType: 'Ride', sourceActivityId: 'ride-1', startIndex: 2, endIndex: 8 },
      ],
    });

    const result = await restoreBackup(json);

    expect(mockEngine.restoreRecordJson).toHaveBeenCalledWith(
      expect.stringContaining('"rep_activity_id":"ride-1"')
    );
    expect(mockEngine.createSectionFromIndices).not.toHaveBeenCalled();
    expect(result.unplacedCount).toBe(1);
  });

  it('does not write malformed or newer decisions', async () => {
    await expect(restoreBackup(makeValidBackup({ version: 3 }))).rejects.toThrow(
      'Unsupported backup version'
    );
    await expect(restoreBackup(makeValidBackup({ customSections: [{}] }))).rejects.toThrow(
      'Corrupt backup'
    );
    expect(mockEngine.restoreRecordJson).not.toHaveBeenCalled();
  });
});

describe('legacy JSON signed-out import', () => {
  it('validates first, then asks for sign-in without writing', async () => {
    mockEngineState.ready = false;
    const result = await restoreBackup(
      makeValidBackup({
        customSections: [
          {
            name: 'Hill',
            sportType: 'Ride',
            sourceActivityId: 'ride-1',
            startIndex: 2,
            endIndex: 8,
          },
        ],
      })
    );
    expect(result).toMatchObject({ failed: true, signInRequired: true });
    expect(mockEngine.restoreRecordJson).not.toHaveBeenCalled();
  });

  it('passes the same record to the engine on repeated import', async () => {
    const json = makeValidBackup({ routeNames: { route: 'Loop' } });
    await restoreBackup(json);
    await restoreBackup(json);
    expect(mockEngine.restoreRecordJson).toHaveBeenCalledTimes(2);
    expect(mockEngine.restoreRecordJson.mock.calls[1][0]).toBe(
      mockEngine.restoreRecordJson.mock.calls[0][0]
    );
  });
});

const PAUSED = [{ kind: 'import', name: null, reason: 'import_paused' }];

describe('record zip and .veloqdb signed-out import', () => {
  beforeEach(() => {
    mockEngineState.ready = false;
  });

  function expectNothingTouched() {
    expect(mockEngine.restoreRecordZip).not.toHaveBeenCalled();
    expect(mockEngine.restoreRecordJson).not.toHaveBeenCalled();
    expect(mockNativeModule.convertLegacyDatabaseToRecordBackup).not.toHaveBeenCalled();
    expect(FileSystem.copyAsync).not.toHaveBeenCalled();
  }

  it('refuses a record zip with the sign-in prompt', async () => {
    await expect(restoreRecordBackup('content://picked/backup.zip')).rejects.toThrow(
      i18n.t('backup.signInRequired', { defaultValue: 'Sign in before importing a backup.' })
    );
    expectNothingTouched();
  });

  it('refuses a check of a record zip before the engine is asked', async () => {
    await expect(checkRecordBackup('content://picked/backup.zip')).rejects.toBeInstanceOf(
      SignInRequiredError
    );
    expect(mockEngine.checkRecordZip).not.toHaveBeenCalled();
  });

  it('refuses a .veloqdb as sign-in required, not as a raw engine error', async () => {
    const result = await restoreDatabaseBackup('content://picked/old.veloqdb');
    expect(result).toMatchObject({ success: false, signInRequired: true });
    expect(result.error).toBe(
      i18n.t('backup.signInRequired', { defaultValue: 'Sign in before importing a backup.' })
    );
    expectNothingTouched();
  });
});

describe('paused record import', () => {
  it('writes nothing when no import is paused', async () => {
    mockEngine.getUnplacedBackupRecords.mockResolvedValueOnce([
      { kind: 'section_pins', name: 'Hill', reason: 'activity_pending' },
    ]);
    await expect(resumeRecordImport()).resolves.toBeNull();
    expect(mockEngine.restoreRecordJson).not.toHaveBeenCalled();
    expect(mockEngine.syncNow).not.toHaveBeenCalled();
  });

  it('places the paused import and hands its missing activities to the sync', async () => {
    mockEngine.getUnplacedBackupRecords.mockResolvedValueOnce(PAUSED);
    mockEngine.restoreRecordJson.mockResolvedValueOnce({
      placed: 3,
      unplaced: 1,
      missingActivityIds: ['old-ride'],
    });

    await expect(resumeRecordImport()).resolves.toEqual({
      placed: 3,
      unplaced: 1,
      missingActivityIds: ['old-ride'],
    });
    expect(JSON.parse(mockEngine.restoreRecordJson.mock.calls[0][0])).toEqual({
      version: 1,
      athlete_id: null,
      entries: [],
    });
    expect(mockEngine.syncNow).toHaveBeenCalledTimes(1);
  });

  it('reloads the in-memory settings once the import is placed, and only then', async () => {
    await resumeRecordImport();
    expect(initializeUnitPreference).not.toHaveBeenCalled();

    mockEngine.getUnplacedBackupRecords.mockResolvedValueOnce(PAUSED);
    await resumeRecordImport();
    expect(initializeUnitPreference).toHaveBeenCalledTimes(1);
  });

  it('leaves a closed engine alone', async () => {
    mockEngineState.ready = false;
    await expect(resumeRecordImport()).resolves.toBeNull();
    expect(mockEngine.getUnplacedBackupRecords).not.toHaveBeenCalled();
    expect(mockEngine.restoreRecordJson).not.toHaveBeenCalled();
  });

  it('discards through the engine and reloads nothing, since nothing was applied', async () => {
    await discardRecordImport();
    expect(mockEngine.discardRecordImport).toHaveBeenCalledTimes(1);
    expect(mockEngine.restoreRecordJson).not.toHaveBeenCalled();
    expect(initializeUnitPreference).not.toHaveBeenCalled();
  });

  it('rejects a discard on a closed engine rather than reporting it done', async () => {
    mockEngineState.ready = false;
    await expect(discardRecordImport()).rejects.toThrow('Engine not initialized');
    expect(mockEngine.discardRecordImport).not.toHaveBeenCalled();
  });

  it('rejects with the engine refusal and keeps the stores as they were', async () => {
    mockEngine.getUnplacedBackupRecords.mockResolvedValueOnce(PAUSED);
    mockEngine.restoreRecordJson.mockRejectedValueOnce(new Error('database or disk is full'));
    await expect(resumeRecordImport()).rejects.toThrow('disk is full');
    expect(mockEngine.syncNow).not.toHaveBeenCalled();
    expect(initializeUnitPreference).not.toHaveBeenCalled();
  });
});

it('reconciles the engine detection switch after a legacy restore with matching off', async () => {
  mockEngine.getSetting.mockReturnValue('1');
  mockEngine.restoreRecordJson.mockImplementationOnce(async (json: string) => {
    const record = JSON.parse(json);
    for (const entry of record.entries) {
      if (entry.table === 'settings') {
        await AsyncStorage.setItem(entry.values.key, entry.values.value);
      }
    }
    return { placed: 1, unplaced: 0, missingActivityIds: [] };
  });

  await restoreBackup(
    JSON.stringify({
      version: 1,
      preferences: { 'veloq-route-settings': { enabled: false } },
    })
  );

  expect(mockEngine.setSetting).toHaveBeenCalledWith('__detection_enabled', '0');
});

it('converts a legacy backup without the orphaned dashboard pills key', () => {
  const record = convertLegacyBackupToRecord(
    JSON.stringify({
      version: 1,
      preferences: {
        dashboard_preferences: { pills: [] },
        dashboard_summary_card: { hero: 'fitness' },
      },
    })
  );
  const keys = record.entries.filter((e) => e.table === 'settings').map((e) => e.values.key);
  expect(keys).toEqual(['dashboard_summary_card']);
});
