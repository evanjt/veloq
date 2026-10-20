/**
 * Scenario: an older build kept generations of the record zip, and older still
 * whole database copies, in the app's private `backups/` directory, which
 * Android deletes with the app. On Android the device copy now lives in the
 * shared `Documents/Veloq`, which outlives an uninstall.
 *
 * Expected behaviour: on the first launch after the upgrade the newest private
 * backup is copied to `Documents/Veloq` and the private directory goes. A copy
 * that fails leaves every private backup for the next launch. A device copy the
 * athlete stopped, Android below 10 and iOS leave the directory alone.
 */

import { Platform } from 'react-native';

import { moveOlderBackupsToSharedFolder } from '@/features/settings/lib/autobackup/backends/localBackend';

const BACKUPS = 'file:///docs/backups/';
const mockSettings = new Map<string, string>();
const mockFiles = new Map<string, string>();
const mockShared = new Map<string, { from: string; mimeType: string }>();
const mockNative: Record<string, jest.Mock> = {};

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    getSetting: (key: string) => mockSettings.get(key),
    setSetting: (key: string, value: string) => mockSettings.set(key, value),
    deleteSetting: (key: string) => mockSettings.delete(key),
  }),
}));

jest.mock('expo-modules-core', () => ({
  ...jest.requireActual('expo-modules-core'),
  requireOptionalNativeModule: (name: string) =>
    name === 'VeloqBackupExclusion' ? mockNative : null,
}));

jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  documentDirectory: 'file:///docs/',
  cacheDirectory: 'file:///cache/',
  getInfoAsync: async (uri: string) => ({
    exists: mockFiles.has(uri) || [...mockFiles.keys()].some((key) => key.startsWith(uri)),
  }),
  readDirectoryAsync: async (uri: string) =>
    [...mockFiles.keys()]
      .filter((key) => key.startsWith(uri))
      .map((key) => key.slice(uri.length))
      .filter((name) => !name.includes('/')),
  readAsStringAsync: async (uri: string) => {
    const content = mockFiles.get(uri);
    if (content === undefined) throw new Error(`missing ${uri}`);
    return content;
  },
  deleteAsync: async (uri: string) => {
    for (const key of [...mockFiles.keys()]) if (key.startsWith(uri)) mockFiles.delete(key);
  },
}));

function seedBackup(id: string, timestamp: string): void {
  mockFiles.set(`${BACKUPS}${id}`, 'bytes');
  mockFiles.set(`${BACKUPS}${id}.meta.json`, JSON.stringify({ id, timestamp, sizeBytes: 5 }));
}

const privateBackups = () => [...mockFiles.keys()].filter((uri) => uri.startsWith(BACKUPS));

const os = Platform.OS;
function onPlatform(platform: 'ios' | 'android'): void {
  Object.defineProperty(Platform, 'OS', { value: platform, configurable: true });
}

beforeEach(() => {
  mockSettings.clear();
  mockFiles.clear();
  mockShared.clear();
  for (const key of Object.keys(mockNative)) delete mockNative[key];
  mockNative.sharedDocumentsSupported = jest.fn(() => true);
  mockNative.writeSharedDocument = jest.fn(async (from: string, name: string, mimeType: string) => {
    mockShared.set(name, { from, mimeType });
    return name;
  });
  onPlatform('android');
  seedBackup('veloq-2026-01-02T08-00-00-000Z.zip', '2026-01-02T08:00:00.000Z');
  seedBackup('veloq-2026-02-03T09-15-00-250Z.zip', '2026-02-03T09:15:00.250Z');
  seedBackup('veloq-2025-11-20.veloqdb', '2025-11-20T07:00:00.000Z');
});

afterEach(() => {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
});

it('copies the newest private backup to Documents/Veloq and deletes the private ones', async () => {
  await moveOlderBackupsToSharedFolder();

  expect([...mockShared]).toEqual([
    [
      'veloq-2026-02-03T09-15-00-250Z.zip',
      { from: '/docs/backups/veloq-2026-02-03T09-15-00-250Z.zip', mimeType: 'application/zip' },
    ],
  ]);
  expect(privateBackups()).toEqual([]);
});

it('copies a whole database copy under its own name when it is the newest', async () => {
  seedBackup('veloq-2026-03-01.veloqdb', '2026-03-01T07:00:00.000Z');

  await moveOlderBackupsToSharedFolder();

  expect([...mockShared]).toEqual([
    [
      'veloq-2026-03-01.veloqdb',
      { from: '/docs/backups/veloq-2026-03-01.veloqdb', mimeType: 'application/octet-stream' },
    ],
  ]);
  expect(privateBackups()).toEqual([]);
});

it('keeps every private backup when the copy fails, and moves it on the next launch', async () => {
  mockNative.writeSharedDocument.mockRejectedValueOnce(new Error('The media store refused it'));

  await expect(moveOlderBackupsToSharedFolder()).rejects.toThrow('refused');
  expect(privateBackups()).toHaveLength(6);

  await moveOlderBackupsToSharedFolder();
  expect(mockShared.size).toBe(1);
  expect(privateBackups()).toEqual([]);
});

it('does nothing on the launch after the move', async () => {
  await moveOlderBackupsToSharedFolder();
  await moveOlderBackupsToSharedFolder();

  expect(mockNative.writeSharedDocument).toHaveBeenCalledTimes(1);
});

it('deletes a directory holding no listed backup without writing anything', async () => {
  mockFiles.clear();
  mockFiles.set(`${BACKUPS}stray.zip`, 'bytes');

  await moveOlderBackupsToSharedFolder();

  expect(mockShared.size).toBe(0);
  expect(privateBackups()).toEqual([]);
});

it('leaves the private backups alone while the athlete has stopped the device copy', async () => {
  mockSettings.set('__backup_folder_off', '1');

  await moveOlderBackupsToSharedFolder();

  expect(mockShared.size).toBe(0);
  expect(privateBackups()).toHaveLength(6);
});

it('moves them even while a picked folder takes the runs', async () => {
  mockSettings.set('__backup_folder', 'content://com.example.documents/tree/primary%3ATraining');

  await moveOlderBackupsToSharedFolder();

  expect(mockShared.size).toBe(1);
  expect(privateBackups()).toEqual([]);
});

it('leaves them alone below Android 10', async () => {
  mockNative.sharedDocumentsSupported.mockReturnValue(false);

  await moveOlderBackupsToSharedFolder();

  expect(mockNative.writeSharedDocument).not.toHaveBeenCalled();
  expect(privateBackups()).toHaveLength(6);
});

it('leaves them alone on iOS, which keeps its own private copy', async () => {
  onPlatform('ios');

  await moveOlderBackupsToSharedFolder();

  expect(mockNative.writeSharedDocument).not.toHaveBeenCalled();
  expect(privateBackups()).toHaveLength(6);
});
