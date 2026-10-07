import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  migrateSettingsToSqlite,
  SETTINGS_MIGRATED_KEY,
} from '@/shared/storage/migrateSettingsToSqlite';

const mockRows = new Map<string, string>();
const mockEngine = {
  getSetting: jest.fn((key: string) => mockRows.get(key)),
  setSetting: jest.fn((key: string, value: string) => mockRows.set(key, value)),
};
let mockEngineReady = true;
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => (mockEngineReady ? mockEngine : null),
}));

const legacyPreferences = [
  ['veloq-known-sensors', '[{"id":"sensor-a","name":"Cadence"}]'],
  [
    'veloq-support-store',
    '{"permanentlyDismissed":true,"isLegacyPurchaser":true,"lastActionDate":"2024-01-01"}',
  ],
  ['veloq-notification-prompt-dismissed', 'true'],
  ['veloq-heatmap-enabled', 'false'],
  ['veloq-track-fetch-dismissed', 'activity-a'],
] as const;

beforeEach(async () => {
  jest.clearAllMocks();
  mockRows.clear();
  mockEngineReady = true;
  await AsyncStorage.clear();
  for (const [key, value] of legacyPreferences) await AsyncStorage.setItem(key, value);
});

it.each(legacyPreferences)('copies %s on a first migration', async (key, value) => {
  await migrateSettingsToSqlite();
  expect(mockRows.get(key)).toBe(value);
  expect(mockRows.get(SETTINGS_MIGRATED_KEY)).toBe('1');
});

it.each(legacyPreferences)(
  'repairs missing %s after the original migration',
  async (key, value) => {
    mockRows.set(SETTINGS_MIGRATED_KEY, '1');
    await migrateSettingsToSqlite();
    expect(mockRows.get(key)).toBe(value);
    expect(await AsyncStorage.getItem(key)).toBe(value);
  }
);

it('preserves existing SQLite rows, including empty values', async () => {
  mockRows.set(SETTINGS_MIGRATED_KEY, '1');
  for (const [key] of legacyPreferences) mockRows.set(key, '');
  await migrateSettingsToSqlite();
  for (const [key] of legacyPreferences) expect(mockRows.get(key)).toBe('');
});

it('does not resurrect deleted preferences or read AsyncStorage after the repair', async () => {
  mockRows.set(SETTINGS_MIGRATED_KEY, '1');
  await migrateSettingsToSqlite();
  for (const [key] of legacyPreferences) expect(mockRows.has(key)).toBe(true);
  for (const [key] of legacyPreferences) mockRows.delete(key);
  jest.mocked(AsyncStorage.getItem).mockClear();
  await migrateSettingsToSqlite();
  expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  for (const [key] of legacyPreferences) expect(mockRows.has(key)).toBe(false);
});

it('leaves absent values absent and completes an empty repair', async () => {
  mockRows.set(SETTINGS_MIGRATED_KEY, '1');
  await AsyncStorage.clear();
  await migrateSettingsToSqlite();
  for (const [key] of legacyPreferences) expect(mockRows.has(key)).toBe(false);
  jest.mocked(AsyncStorage.getItem).mockClear();
  await migrateSettingsToSqlite();
  expect(AsyncStorage.getItem).not.toHaveBeenCalled();
});

it('waits for the engine before marking either pass complete', async () => {
  mockEngineReady = false;
  await migrateSettingsToSqlite();
  expect(mockRows.size).toBe(0);
  mockEngineReady = true;
  await migrateSettingsToSqlite();
  for (const [key, value] of legacyPreferences) expect(mockRows.get(key)).toBe(value);
});

it('retries a failed read on the next boot without overwriting completed rows', async () => {
  mockRows.set(SETTINGS_MIGRATED_KEY, '1');
  jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('read failed'));
  await migrateSettingsToSqlite();
  mockRows.set('veloq-support-store', 'newer');
  await migrateSettingsToSqlite();
  expect(mockRows.get('veloq-known-sensors')).toBe(legacyPreferences[0][1]);
  expect(mockRows.get('veloq-support-store')).toBe('newer');
});

it('retries a failed SQLite write on the next boot', async () => {
  mockRows.set(SETTINGS_MIGRATED_KEY, '1');
  mockEngine.setSetting.mockImplementationOnce(() => {
    throw new Error('write failed');
  });
  await migrateSettingsToSqlite();
  await migrateSettingsToSqlite();
  for (const [key, value] of legacyPreferences) expect(mockRows.get(key)).toBe(value);
});

it('preserves a preference written while the legacy read is pending', async () => {
  mockRows.set(SETTINGS_MIGRATED_KEY, '1');
  jest.mocked(AsyncStorage.getItem).mockImplementationOnce(async () => {
    mockRows.set('veloq-known-sensors', 'newer');
    return legacyPreferences[0][1];
  });
  await migrateSettingsToSqlite();
  expect(mockRows.get('veloq-known-sensors')).toBe('newer');
});

it('does not copy section lists whose readers no longer exist', async () => {
  await AsyncStorage.setItem('veloq-disabled-sections', '["a"]');
  await AsyncStorage.setItem('veloq-superseded-sections', '["b"]');
  await migrateSettingsToSqlite();
  expect(mockRows.has('veloq-disabled-sections')).toBe(false);
  expect(mockRows.has('veloq-superseded-sections')).toBe(false);
});
