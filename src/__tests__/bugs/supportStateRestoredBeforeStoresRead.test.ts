/**
 * Scenario: an install that finished the original settings migration but never
 * copied the preferences it omitted (the support state) updates, and its
 * support state lives only in AsyncStorage.
 *
 * Expected behaviour: the repair copy runs before the stores read, so the
 * support store restores the old state and the engine row matches it.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import { initialiseApp } from '@/shared/app/launch';
import { useSupportStore } from '@/shared/app/SupportStore';

type Call = { name: string; key?: string };

const calls: Call[] = [];
const stored = new Map<string, string>();

let mockEngineOpen = false;
let mockRouteDbPath = '/data/routes.db';
const mockFiles = new Set<string>();

const mockEngine = {
  get ready(): boolean {
    return mockEngineOpen;
  },
  initWithPath: jest.fn((path: string): boolean => {
    calls.push({ name: 'initWithPath', key: path });
    mockEngineOpen = true;
    return true;
  }),
  openWithPath: jest.fn(async (path: string): Promise<boolean> => mockEngine.initWithPath(path)),
  getSetting: jest.fn((key: string): string | undefined => {
    calls.push({ name: 'getSetting', key });
    return mockEngineOpen ? stored.get(key) : undefined;
  }),
  setSetting: jest.fn(),
  setSettings: jest.fn(),
  deleteSetting: jest.fn(),
  getActivityCount: jest.fn(() => {
    calls.push({ name: 'getActivityCount' });
    return 408;
  }),
  setSyncCredentials: jest.fn(),
  clearSyncCredentials: jest.fn(),
  getUnplacedBackupRecords: jest.fn(async () => {
    calls.push({ name: 'getUnplacedBackupRecords' });
    return [{ kind: 'import', name: null, reason: 'import_paused' }];
  }),
  restoreRecordJson: jest.fn(async () => {
    calls.push({ name: 'restoreRecordJson' });
    return { placed: 1, unplaced: 0, missingActivityIds: [] };
  }),
  syncNow: jest.fn(),
  runRecordBackup: jest.fn(async (path: string) => {
    mockFiles.add(`file://${path}`);
  }),
};

jest.mock('@/features/settings/stores/DebugStore', () => ({
  initialiseDebugStore: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockEngine,
  getRouteDbPath: () => mockRouteDbPath,
  isEngineReady: () => mockEngineOpen,
  resolveRouteDbPath: () => {
    calls.push({ name: 'resolveRouteDbPath' });
    return Promise.resolve(mockRouteDbPath);
  },
}));

jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  documentDirectory: 'file:///data/documents/',
  cacheDirectory: 'file:///cache/',
  makeDirectoryAsync: jest.fn().mockResolvedValue(undefined),
  readDirectoryAsync: jest.fn(async (dir: string) => [
    ...new Set(
      [...mockFiles]
        .filter((uri) => uri.startsWith(dir))
        .map((uri) => uri.slice(dir.length).split('/')[0])
    ),
  ]),
  deleteAsync: jest.fn(async (uri: string) => {
    mockFiles.delete(uri);
  }),
}));

jest.mock('@/features/settings/lib/shareFile', () => ({
  shareExistingFile: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/native/backupExclusion', () => ({
  excludeFromBackup: jest.fn(() => true),
  excludeExistingFromBackup: jest.fn(() => true),
}));

const secureGet = SecureStore.getItemAsync as jest.Mock;

function keychain(values: Record<string, string>): void {
  secureGet.mockImplementation((key: string) => Promise.resolve(values[key] ?? null));
}

beforeEach(() => {
  stored.clear();
  mockEngineOpen = false;
});

it('restores an omitted preference from storage before its store reads it', async () => {
  keychain({ intervals_api_key: 'key', intervals_athlete_id: 'i12345' });
  stored.set('__settings_migrated', '1');
  mockEngine.setSetting.mockImplementation((key: string, value: string) => {
    stored.set(key, value);
  });
  await AsyncStorage.setItem(
    'veloq-support-store',
    JSON.stringify({ permanentlyDismissed: true, isLegacyPurchaser: true, dismissCount: 2 })
  );

  await initialiseApp();

  expect(useSupportStore.getState().permanentlyDismissed).toBe(true);
  expect(useSupportStore.getState().isLegacyPurchaser).toBe(true);
  expect(JSON.parse(stored.get('veloq-support-store') ?? '{}')).toMatchObject({
    permanentlyDismissed: true,
    isLegacyPurchaser: true,
  });
});
