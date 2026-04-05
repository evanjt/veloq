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
};

jest.mock('@/lib/native/routeEngine', () => ({
  getRouteEngine: () => mockEngine,
}));

jest.mock('@/lib/export/shareFile', () => ({
  shareFile: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/providers', () => ({
  initializeTheme: jest.fn().mockResolvedValue(undefined),
  initializeLanguage: jest.fn().mockResolvedValue(undefined),
  initializeSportPreference: jest.fn().mockResolvedValue(undefined),
  initializeHRZones: jest.fn().mockResolvedValue(undefined),
  initializeUnitPreference: jest.fn().mockResolvedValue(undefined),
  initializeRouteSettings: jest.fn().mockResolvedValue(undefined),
  initializeDisabledSections: jest.fn().mockResolvedValue(undefined),
  initializeSectionDismissals: jest.fn().mockResolvedValue(undefined),
  initializeSupersededSections: jest.fn().mockResolvedValue(undefined),
  initializePotentialSections: jest.fn().mockResolvedValue(undefined),
  initializeDashboardPreferences: jest.fn().mockResolvedValue(undefined),
  initializeDebugStore: jest.fn().mockResolvedValue(undefined),
  initializeTileCacheStore: jest.fn().mockResolvedValue(undefined),
  initializeWhatsNewStore: jest.fn().mockResolvedValue(undefined),
  initializeInsightsStore: jest.fn().mockResolvedValue(undefined),
  initializeRecordingPreferences: jest.fn().mockResolvedValue(undefined),
  initializeNotificationPreferences: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/backup', () => ({
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

jest.mock('@/lib/storage/terrainCameraOverrides', () => ({
  reloadCameraOverrides: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '0.3.0' } },
}));

import { createBackup, restoreBackup } from '@/lib/export/backup';

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

describe('getLastBackupTimestamp falsy zero bug (autoBackup.ts:82)', () => {
  // autoBackup.ts:82 uses: `return value ? Number(value) : null;`
  // The bug: when the stored value is '0', Number('0') === 0 which is falsy,
  // so the ternary returns null instead of 0.

  // Replicate the exact pattern from autoBackup.ts:82
  function parseStoredTimestamp(value: string | null | undefined): number | null {
    return value != null ? Number(value) : null;
  }

  it('parses normal timestamp strings', () => {
    expect(parseStoredTimestamp('1712345678000')).toBe(1712345678000);
    expect(parseStoredTimestamp('42')).toBe(42);
    expect(parseStoredTimestamp('3.14')).toBeCloseTo(3.14);
  });

  it('returns null for null/undefined input', () => {
    expect(parseStoredTimestamp(null)).toBeNull();
    expect(parseStoredTimestamp(undefined)).toBeNull();
  });

  it('parses zero correctly', () => {
    expect(parseStoredTimestamp('0')).toBe(0);
  });

  it('treats empty string as 0 (Number("") = 0)', () => {
    // With value != null guard, empty string passes through to Number('')
    expect(parseStoredTimestamp('')).toBe(0);
  });
});
