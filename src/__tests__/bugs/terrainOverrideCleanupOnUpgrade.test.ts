import AsyncStorage from '@react-native-async-storage/async-storage';
import { migrateSettingsToSqlite } from '@/shared/storage/migrateSettingsToSqlite';

const OVERRIDES = 'veloq-map-activity-overrides';
const DONE = 'veloq-terrain-override-cleanup-done';

const mockRows = new Map<string, string>();
const mockEngine = {
  getSetting: jest.fn((key: string) => mockRows.get(key)),
  setSetting: jest.fn((key: string, value: string) => mockRows.set(key, value)),
};
jest.mock('@/shared/native/engine', () => ({ getEngine: () => mockEngine }));

const stored = {
  a: { style: 'dark', terrain3D: false },
  b: { terrain3D: false },
  c: { style: 'light', terrain3D: true },
  d: { style: 'satellite' },
};

beforeEach(async () => {
  jest.clearAllMocks();
  mockRows.clear();
  await AsyncStorage.clear();
});

it('removes only terrain3D false from stored overrides, keeping styles and true', async () => {
  mockRows.set(OVERRIDES, JSON.stringify(stored));
  await migrateSettingsToSqlite();
  expect(JSON.parse(mockRows.get(OVERRIDES)!)).toEqual({
    a: { style: 'dark' },
    c: { style: 'light', terrain3D: true },
    d: { style: 'satellite' },
  });
  expect(mockRows.get(DONE)).toBe('1');
});

it('runs once: an override written after the cleanup is left alone', async () => {
  mockRows.set(OVERRIDES, JSON.stringify(stored));
  await migrateSettingsToSqlite();
  const later = JSON.stringify({ z: { terrain3D: false } });
  mockRows.set(OVERRIDES, later);
  await migrateSettingsToSqlite();
  expect(mockRows.get(OVERRIDES)).toBe(later);
});

it('marks done and writes nothing else when there are no overrides', async () => {
  await migrateSettingsToSqlite();
  expect(mockRows.has(OVERRIDES)).toBe(false);
  expect(mockRows.get(DONE)).toBe('1');
});

it('leaves unparseable overrides untouched and retries next boot', async () => {
  mockRows.set(OVERRIDES, '{not json');
  await migrateSettingsToSqlite();
  expect(mockRows.get(OVERRIDES)).toBe('{not json');
  expect(mockRows.has(DONE)).toBe(false);
});

it('cleans overrides copied from AsyncStorage by the first migration', async () => {
  await AsyncStorage.setItem(OVERRIDES, JSON.stringify(stored));
  await migrateSettingsToSqlite();
  expect(JSON.parse(mockRows.get(OVERRIDES)!).b).toBeUndefined();
  expect(JSON.parse(mockRows.get(OVERRIDES)!).a).toEqual({ style: 'dark' });
});
