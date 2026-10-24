/**
 * Scenario: an older build kept generations of the record zip, and older still
 * whole database copies, in the app's private `backups/` directory, which
 * Android deletes with the app. On Android the device copy now lives in the
 * shared `Documents/Veloq`, which outlives an uninstall.
 *
 * Expected behaviour: on the first launch after the upgrade every backup in the
 * private directory and every sidecar is copied to `Documents/Veloq` and checked
 * by size against the shared folder's listing. A private file is deleted only
 * once its own copy has checked, and the directory goes once nothing in it is
 * left. A backup the listing does not show, one whose sidecar is missing or
 * unreadable, is copied all the same. A copy that fails leaves what has not
 * moved for the next launch. A device copy the athlete stopped, Android below 10
 * and iOS leave the directory alone.
 */

import { Platform } from 'react-native';

import { moveOlderBackupsToSharedFolder } from '@/features/settings/lib/autobackup/backends/localBackend';

const BACKUPS = 'file:///docs/backups/';
const ZIP_OLD = 'veloq-2026-01-02T08-00-00-000Z.zip';
const ZIP_NEW = 'veloq-2026-02-03T09-15-00-250Z.zip';
const DB_OLD = 'veloq-2025-11-20.veloqdb';
const mockSettings = new Map<string, string>();
const mockFiles = new Map<string, string>();
const mockShared = new Map<string, { from: string; mimeType: string; size: number }>();
const mockNative: Record<string, jest.Mock> = {};
const mockFailDelete = new Set<string>();

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
  getInfoAsync: async (uri: string) => {
    if (mockFiles.has(uri)) return { exists: true, size: mockFiles.get(uri)?.length };
    return { exists: [...mockFiles.keys()].some((key) => key.startsWith(uri)) };
  },
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
    if (mockFailDelete.delete(uri)) throw new Error(`The delete of ${uri} failed`);
    if (!uri.endsWith('/')) {
      mockFiles.delete(uri);
      return;
    }
    for (const key of [...mockFiles.keys()]) if (key.startsWith(uri)) mockFiles.delete(key);
  },
}));

function seedBackup(id: string, timestamp: string): void {
  mockFiles.set(`${BACKUPS}${id}`, 'bytes');
  mockFiles.set(`${BACKUPS}${id}.meta.json`, JSON.stringify({ id, timestamp, sizeBytes: 5 }));
}

const privateBackups = () => [...mockFiles.keys()].filter((uri) => uri.startsWith(BACKUPS));
const sharedNames = () => [...mockShared.keys()];

/** The media store keeps a second file of the same display name under a numbered name. */
function storedName(name: string): string {
  if (!mockShared.has(name)) return name;
  const dot = name.lastIndexOf('.');
  for (let n = 1; ; n++) {
    const candidate = `${name.slice(0, dot)} (${n})${name.slice(dot)}`;
    if (!mockShared.has(candidate)) return candidate;
  }
}

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
    const stored = storedName(name);
    mockShared.set(stored, { from, mimeType, size: mockFiles.get(`file://${from}`)?.length ?? 0 });
    return stored;
  });
  mockNative.listSharedDocuments = jest.fn(async () =>
    [...mockShared].map(([name, file]) => ({ name, size: file.size }))
  );
  onPlatform('android');
  seedBackup(ZIP_OLD, '2026-01-02T08:00:00.000Z');
  seedBackup(ZIP_NEW, '2026-02-03T09:15:00.250Z');
  seedBackup(DB_OLD, '2025-11-20T07:00:00.000Z');
});

afterEach(() => {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
});

it('copies every private backup and sidecar to Documents/Veloq, then deletes the private ones', async () => {
  await moveOlderBackupsToSharedFolder();

  expect(sharedNames()).toHaveLength(6);
  expect(mockShared.get(ZIP_NEW)).toEqual({
    from: `/docs/backups/${ZIP_NEW}`,
    mimeType: 'application/zip',
    size: 5,
  });
  expect(mockShared.get(`${ZIP_NEW}.meta.json`)?.mimeType).toBe('application/json');
  expect(privateBackups()).toEqual([]);
});

it('copies a whole database copy that has no sidecar under its own name', async () => {
  mockFiles.set(`${BACKUPS}veloq-2026-03-01.veloqdb`, 'bytes');

  await moveOlderBackupsToSharedFolder();

  expect(mockShared.get('veloq-2026-03-01.veloqdb')).toEqual({
    from: '/docs/backups/veloq-2026-03-01.veloqdb',
    mimeType: 'application/octet-stream',
    size: 5,
  });
  expect(privateBackups()).toEqual([]);
});

it('copies a record zip whose sidecar is missing or unreadable, and the directory goes', async () => {
  mockFiles.clear();
  mockFiles.set(`${BACKUPS}${ZIP_OLD}`, 'bytes');
  mockFiles.set(`${BACKUPS}${ZIP_NEW}`, 'bytes');
  mockFiles.set(`${BACKUPS}${ZIP_NEW}.meta.json`, '{not json');

  await moveOlderBackupsToSharedFolder();

  expect(sharedNames().sort()).toEqual([ZIP_OLD, ZIP_NEW, `${ZIP_NEW}.meta.json`].sort());
  expect(privateBackups()).toEqual([]);
});

it('keeps every private file when the copy fails, and moves it on the next launch', async () => {
  mockNative.writeSharedDocument.mockRejectedValueOnce(new Error('The media store refused it'));

  await expect(moveOlderBackupsToSharedFolder()).rejects.toThrow('refused');
  expect(privateBackups()).toHaveLength(6);

  await moveOlderBackupsToSharedFolder();
  expect(sharedNames()).toHaveLength(6);
  expect(privateBackups()).toEqual([]);
});

it('deletes each private file once its copy checks, and keeps the rest when a later copy fails', async () => {
  const copy = mockNative.writeSharedDocument.getMockImplementation()!;
  let calls = 0;
  mockNative.writeSharedDocument.mockImplementation(async (...args: [string, string, string]) => {
    calls += 1;
    if (calls === 3) throw new Error('The media store refused it');
    return copy(...args);
  });

  await expect(moveOlderBackupsToSharedFolder()).rejects.toThrow('refused');

  expect(sharedNames()).toEqual([ZIP_OLD, `${ZIP_OLD}.meta.json`]);
  expect(privateBackups()).toHaveLength(4);
  expect(mockFiles.has(`${BACKUPS}${ZIP_OLD}`)).toBe(false);
});

it('does not copy again a file the shared folder already holds when its private delete failed', async () => {
  mockFailDelete.add(`${BACKUPS}${ZIP_OLD}`);

  await expect(moveOlderBackupsToSharedFolder()).rejects.toThrow('delete');
  expect(sharedNames()).toEqual([ZIP_OLD]);

  await moveOlderBackupsToSharedFolder();

  expect(sharedNames()).toHaveLength(6);
  expect(sharedNames().filter((name) => name.startsWith('veloq-2026-01-02'))).toEqual([
    ZIP_OLD,
    `${ZIP_OLD}.meta.json`,
  ]);
  expect(privateBackups()).toEqual([]);
});

it('keeps a private file whose shared copy does not match its size', async () => {
  mockNative.writeSharedDocument.mockImplementationOnce(async (from: string, name: string) => {
    mockShared.set(name, { from, mimeType: 'application/zip', size: 1 });
    return name;
  });

  await expect(moveOlderBackupsToSharedFolder()).rejects.toThrow('does not match');
  expect(privateBackups()).toHaveLength(6);
});

it('does nothing on the launch after the move', async () => {
  await moveOlderBackupsToSharedFolder();
  await moveOlderBackupsToSharedFolder();

  expect(mockNative.writeSharedDocument).toHaveBeenCalledTimes(6);
});

it('keeps the directory when it holds a file that is neither a backup nor a sidecar', async () => {
  mockFiles.set(`${BACKUPS}notes.txt`, 'bytes');

  await moveOlderBackupsToSharedFolder();

  expect(sharedNames()).toHaveLength(6);
  expect(privateBackups()).toEqual([`${BACKUPS}notes.txt`]);
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

  expect(sharedNames()).toHaveLength(6);
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
