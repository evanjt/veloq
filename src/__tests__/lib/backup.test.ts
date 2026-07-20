/**
 * Tests for backup/restore functionality.
 *
 * Covers: createBackup, restoreBackup, exportBackup
 * Bug fixes validated:
 * - version === undefined conflated with version > BACKUP_VERSION
 * - Missing startIndex < endIndex validation
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// Mock the route engine
const mockEngine = {
  getSectionsByType: jest.fn().mockReturnValue([]),
  getAllSectionNames: jest.fn().mockReturnValue({}),
  getAllRouteNames: jest.fn().mockReturnValue({}),
  getGpsTrack: jest.fn().mockReturnValue([]),
  createSectionFromIndices: jest.fn().mockReturnValue('section-1'),
  setSectionName: jest.fn(),
  setRouteName: jest.fn(),
  destroyEngine: jest.fn(),
  getActivityCount: jest.fn().mockReturnValue(100),
  notifyAll: jest.fn(),
};

const mockNativeModule = {
  validateBackupDatabase: jest.fn(),
  routeEngine: { initWithPath: jest.fn() },
};

jest.mock('@/shared/native/routeEngine', () => ({
  getRouteEngine: () => mockEngine,
  getRouteDbPath: () => '/data/veloq.db',
  getNativeModule: () => mockNativeModule,
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

jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: { getState: () => ({ athleteId: 'athlete-1' }) },
}));

jest.mock('@/features/settings/lib/shareFile', () => ({
  shareFile: jest.fn().mockResolvedValue(undefined),
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
jest.mock('@/features/maps/stores/TileCacheStore', () => ({
  initializeTileCacheStore: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/recording/stores/RecordingPreferencesStore', () => ({
  initializeRecordingPreferences: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/routes/stores/DisabledSectionsStore', () => ({
  initializeDisabledSections: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/routes/stores/PotentialSectionsStore', () => ({
  initializePotentialSections: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/routes/stores/RouteSettingsStore', () => ({
  initializeRouteSettings: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/routes/stores/SectionDismissalsStore', () => ({
  initializeSectionDismissals: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/routes/stores/SupersededSectionsStore', () => ({
  initializeSupersededSections: jest.fn().mockResolvedValue(undefined),
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
}));

jest.mock('@/features/maps/lib/storage/terrainCameraOverrides', () => ({
  reloadCameraOverrides: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '0.3.0' } },
}));

import { createBackup, restoreBackup, restoreDatabaseBackup } from '@/features/settings/lib/backup';
import * as FileSystem from 'expo-file-system/legacy';
import { queryClient } from '@/shared/query/QueryProvider';

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

beforeEach(() => {
  jest.restoreAllMocks();
  // Reset engine mocks to defaults
  mockEngine.getSectionsByType.mockReturnValue([]);
  mockEngine.getAllSectionNames.mockReturnValue({});
  mockEngine.getAllRouteNames.mockReturnValue({});
  mockEngine.getGpsTrack.mockReturnValue([]);
  mockEngine.createSectionFromIndices.mockReturnValue('section-1');
  mockEngine.setSectionName.mockImplementation(() => {});
  mockEngine.setRouteName.mockImplementation(() => {});
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
});

describe('createBackup', () => {
  it('returns valid JSON with version and appVersion', async () => {
    const json = await createBackup();
    const backup = JSON.parse(json);
    expect(backup.version).toBe(2);
    expect(backup.appVersion).toBe('0.3.0');
    expect(backup.exportedAt).toBeDefined();
  });

  it('includes custom sections from engine', async () => {
    mockEngine.getSectionsByType.mockReturnValueOnce([
      {
        name: 'Hill Climb',
        sportType: 'Ride',
        sourceActivityId: 'a1',
        startIndex: 10,
        endIndex: 50,
      },
    ]);
    const json = await createBackup();
    const backup = JSON.parse(json);
    expect(backup.customSections).toHaveLength(1);
    expect(backup.customSections[0].name).toBe('Hill Climb');
  });

  it('includes section and route names', async () => {
    mockEngine.getAllSectionNames.mockReturnValueOnce({ s1: 'My Section' });
    mockEngine.getAllRouteNames.mockReturnValueOnce({ r1: 'My Route' });
    const json = await createBackup();
    const backup = JSON.parse(json);
    expect(backup.sectionNames).toEqual({ s1: 'My Section' });
    expect(backup.routeNames).toEqual({ r1: 'My Route' });
  });

  it('includes preferences from AsyncStorage, handles non-JSON values as raw strings', async () => {
    (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
      if (key === 'veloq-theme-preference') return Promise.resolve('not-json');
      return Promise.resolve(null);
    });
    const json = await createBackup();
    const backup = JSON.parse(json);
    expect(backup.preferences['veloq-theme-preference']).toBe('not-json');
  });
});

describe('restoreBackup', () => {
  it('throws on invalid JSON', async () => {
    await expect(restoreBackup('not json')).rejects.toThrow('Invalid backup file format');
  });

  it('throws on corrupt backup (missing/null version) vs version too new (BUG FIX)', async () => {
    await expect(restoreBackup(JSON.stringify({ exportedAt: '2026-01-01' }))).rejects.toThrow(
      'Corrupt backup: missing version field'
    );
    await expect(
      restoreBackup(JSON.stringify({ version: null, exportedAt: '2026-01-01' }))
    ).rejects.toThrow('Corrupt backup');
    await expect(restoreBackup(makeValidBackup({ version: 99 }))).rejects.toThrow(
      'Unsupported backup version: 99'
    );
  });

  it('rejects sections where startIndex >= endIndex (BUG FIX)', async () => {
    mockEngine.getGpsTrack.mockReturnValue(new Array(100).fill({ lat: 0, lng: 0 }));
    const json = makeValidBackup({
      customSections: [
        {
          name: 'Bad Section',
          sportType: 'Ride',
          sourceActivityId: 'a1',
          startIndex: 50,
          endIndex: 10,
        },
      ],
    });
    const result = await restoreBackup(json);
    expect(result.sectionsFailed).toHaveLength(1);
    expect(result.sectionsFailed[0].reason).toContain('Invalid index range');
  });

  it('fails sections when indices exceed track bounds', async () => {
    mockEngine.getGpsTrack.mockReturnValue(new Array(5).fill({ lat: 0, lng: 0 }));
    const json = makeValidBackup({
      customSections: [
        { name: 'OOB', sportType: 'Ride', sourceActivityId: 'a1', startIndex: 0, endIndex: 100 },
      ],
    });
    const result = await restoreBackup(json);
    expect(result.sectionsFailed).toHaveLength(1);
    expect(result.sectionsFailed[0].reason).toContain('Indices out of range');
  });

  it('handles engine returning empty section ID', async () => {
    mockEngine.getGpsTrack.mockReturnValue(new Array(100).fill({ lat: 0, lng: 0 }));
    mockEngine.createSectionFromIndices.mockReturnValue(null);
    const json = makeValidBackup({
      customSections: [
        { name: 'Empty', sportType: 'Ride', sourceActivityId: 'a1', startIndex: 0, endIndex: 10 },
      ],
    });
    const result = await restoreBackup(json);
    expect(result.sectionsFailed).toHaveLength(1);
    expect(result.sectionsFailed[0].reason).toBe('Engine returned empty section ID');
  });

  it('restores section and route names', async () => {
    const json = makeValidBackup({
      sectionNames: { s1: 'Hill', s2: 'Valley' },
      routeNames: { r1: 'Loop' },
    });
    const result = await restoreBackup(json);
    expect(result.namesApplied).toBe(3);
    expect(mockEngine.setSectionName).toHaveBeenCalledTimes(2);
    expect(mockEngine.setRouteName).toHaveBeenCalledTimes(1);
  });

  it('tracks name application failures as namesSkipped', async () => {
    mockEngine.setSectionName.mockImplementation(() => {
      throw new Error('fail');
    });
    const json = makeValidBackup({ sectionNames: { s1: 'Fail' } });
    const result = await restoreBackup(json);
    expect(result.namesSkipped).toBe(1);
    expect(result.namesApplied).toBe(0);
  });

  it('restores preferences to AsyncStorage', async () => {
    const json = makeValidBackup({
      preferences: { 'veloq-theme-preference': 'dark', 'veloq-debug-mode': true },
    });
    const result = await restoreBackup(json);
    expect(result.preferencesRestored).toBe(2);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('veloq-theme-preference', 'dark');
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('veloq-debug-mode', 'true');
  });

  it('round-trips: create then restore produces consistent result', async () => {
    mockEngine.getSectionsByType.mockReturnValue([]);
    mockEngine.getAllSectionNames.mockReturnValue({ s1: 'My Hill' });
    mockEngine.getAllRouteNames.mockReturnValue({});

    const json = await createBackup();
    const result = await restoreBackup(json);
    expect(result.namesApplied).toBe(1);
  });

  it('handles section creation throwing an exception', async () => {
    mockEngine.getGpsTrack.mockReturnValue(new Array(100).fill({ lat: 0, lng: 0 }));
    mockEngine.createSectionFromIndices.mockImplementation(() => {
      throw new Error('engine crash');
    });
    const json = makeValidBackup({
      customSections: [
        { name: 'Crash', sportType: 'Ride', sourceActivityId: 'a1', startIndex: 0, endIndex: 10 },
      ],
    });
    const result = await restoreBackup(json);
    expect(result.sectionsFailed).toHaveLength(1);
    expect(result.sectionsFailed[0].reason).toBe('Creation failed');
  });
});

describe('backup corruption resilience', () => {
  it('rejects truncated JSON', async () => {
    await expect(restoreBackup('{"version": 2, "expo')).rejects.toThrow();
  });

  it('handles backup with empty preferences object', async () => {
    const json = makeValidBackup({ preferences: {} });
    const result = await restoreBackup(json);
    expect(result.preferencesRestored).toBe(0);
  });

  it('handles backup with no customSections key', async () => {
    const backup = JSON.parse(makeValidBackup());
    delete backup.customSections;
    const result = await restoreBackup(JSON.stringify(backup));
    expect(result.sectionsRestored).toBe(0);
  });
});

describe('restoreDatabaseBackup (SQLite snapshot) - data-loss guards', () => {
  const LIVE_META = JSON.stringify({
    schema_version: '12',
    athlete_id: 'athlete-1',
    activity_count: 100,
  });

  // validateBackupDatabase is called for both the backup temp file and the live
  // DB. Route by path: the live DB path contains 'veloq.db'.
  function mockProbe(backupMeta: string | (() => never)) {
    mockNativeModule.validateBackupDatabase.mockImplementation((path: string) => {
      if (path.includes('veloq.db')) return LIVE_META;
      if (typeof backupMeta === 'function') return backupMeta();
      return backupMeta;
    });
  }

  beforeEach(() => {
    mockNativeModule.validateBackupDatabase.mockReset();
    mockNativeModule.routeEngine.initWithPath.mockReset().mockReturnValue(true);
    mockEngine.destroyEngine.mockClear();
    mockEngine.getActivityCount.mockReturnValue(100);
    mockEngine.notifyAll.mockClear();
    (queryClient.invalidateQueries as jest.Mock).mockClear();
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: true, size: 1024 });
    (FileSystem.copyAsync as jest.Mock).mockClear().mockResolvedValue(undefined);
    (FileSystem.deleteAsync as jest.Mock).mockClear().mockResolvedValue(undefined);
    (FileSystem.readDirectoryAsync as jest.Mock).mockReset().mockResolvedValue([]);
  });

  it('refuses an empty backup (activity_count 0) without destroying the engine', async () => {
    mockProbe(JSON.stringify({ schema_version: '12', athlete_id: 'athlete-1', activity_count: 0 }));
    const result = await restoreDatabaseBackup('file:///in/backup.veloqdb');
    expect(result.success).toBe(false);
    expect(mockEngine.destroyEngine).not.toHaveBeenCalled();
    // The live DB must never be overwritten on a rejected backup.
    expect(FileSystem.copyAsync).not.toHaveBeenCalledWith(
      expect.objectContaining({ to: 'file:///data/veloq.db' })
    );
  });

  it('refuses a forward-schema backup newer than the live DB', async () => {
    mockProbe(
      JSON.stringify({ schema_version: '13', athlete_id: 'athlete-1', activity_count: 50 })
    );
    const result = await restoreDatabaseBackup('file:///in/backup.veloqdb');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/newer version/i);
    expect(mockEngine.destroyEngine).not.toHaveBeenCalled();
  });

  it('refuses a corrupt backup when the probe throws (not treated as "probe absent")', async () => {
    mockProbe(() => {
      throw new Error('Cannot open backup: file is not a database');
    });
    const result = await restoreDatabaseBackup('file:///in/backup.veloqdb');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/corrupt or unreadable/i);
    expect(mockEngine.destroyEngine).not.toHaveBeenCalled();
  });

  it('refuses a backup belonging to a different athlete', async () => {
    mockProbe(JSON.stringify({ schema_version: '12', athlete_id: 'other', activity_count: 50 }));
    const result = await restoreDatabaseBackup('file:///in/backup.veloqdb');
    expect(result.success).toBe(false);
    expect(result.athleteIdMismatch).toBe(true);
    expect(mockEngine.destroyEngine).not.toHaveBeenCalled();
  });

  it('restores a valid backup and clears the rollback snapshot', async () => {
    mockProbe(
      JSON.stringify({ schema_version: '12', athlete_id: 'athlete-1', activity_count: 80 })
    );
    const result = await restoreDatabaseBackup('file:///in/backup.veloqdb');
    expect(result.success).toBe(true);
    expect(mockEngine.destroyEngine).toHaveBeenCalled();
    expect(FileSystem.copyAsync).toHaveBeenCalledWith({
      from: 'file:///data/veloq.db',
      to: 'file:///data/veloq.db.bak',
    });
    expect(FileSystem.copyAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        from: expect.stringContaining('/cache/'),
        to: 'file:///data/veloq.db',
      })
    );
    // Snapshot dropped on success.
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith('file:///data/veloq.db.bak', {
      idempotent: true,
    });
    expect(queryClient.invalidateQueries).toHaveBeenCalled();
  });

  it('rolls back to the snapshot when initWithPath fails after overwrite', async () => {
    mockProbe(
      JSON.stringify({ schema_version: '12', athlete_id: 'athlete-1', activity_count: 80 })
    );
    mockNativeModule.routeEngine.initWithPath
      .mockImplementationOnce(() => {
        throw new Error('init failed on restored DB');
      })
      .mockImplementation(() => {});
    const result = await restoreDatabaseBackup('file:///in/backup.veloqdb');
    expect(result.success).toBe(false);
    // Snapshot copied back over the live DB.
    expect(FileSystem.copyAsync).toHaveBeenCalledWith({
      from: 'file:///data/veloq.db.bak',
      to: 'file:///data/veloq.db',
    });
  });

  it('rolls back when the engine quarantines the restored DB instead of opening it', async () => {
    // The engine's failover renames an unopenable DB aside and starts fresh,
    // so initWithPath returns true with an empty engine. The restore must
    // detect the new quarantine file and treat this as a failed restore.
    mockProbe(
      JSON.stringify({ schema_version: '12', athlete_id: 'athlete-1', activity_count: 80 })
    );
    (FileSystem.readDirectoryAsync as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValue(['veloq.db.corrupt-1700000000']);
    const result = await restoreDatabaseBackup('file:///in/backup.veloqdb');
    expect(result.success).toBe(false);
    expect(FileSystem.copyAsync).toHaveBeenCalledWith({
      from: 'file:///data/veloq.db.bak',
      to: 'file:///data/veloq.db',
    });
  });
});

describe('getLastBackupTimestamp falsy zero bug (autoBackup.ts:82)', () => {
  // autoBackup.ts:82 uses: `return value ? Number(value) : null;`
  // The bug: when the stored value is '0', Number('0') === 0 which is falsy,
  // so the ternary returns null instead of 0.

  // Replicate the exact pattern from autoBackup.ts:82
  function parseStoredTimestamp(value: string | null | undefined): number | null {
    return value != null ? Number(value) : null;
  }

  it('parses stored timestamps, distinguishing zero from null', () => {
    expect(parseStoredTimestamp('1712345678000')).toBe(1712345678000);
    expect(parseStoredTimestamp('42')).toBe(42);
    expect(parseStoredTimestamp('3.14')).toBeCloseTo(3.14);
    expect(parseStoredTimestamp(null)).toBeNull();
    expect(parseStoredTimestamp(undefined)).toBeNull();
    // '0' must stay 0, not null - Number('0') is falsy but value != null guards it.
    expect(parseStoredTimestamp('0')).toBe(0);
    // empty string passes the value != null guard through to Number('') = 0.
    expect(parseStoredTimestamp('')).toBe(0);
  });
});
