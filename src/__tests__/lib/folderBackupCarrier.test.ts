/**
 * Scenario: the athlete picks a folder of their own, a Files folder on iOS or
 * a storage-access folder on Android, and automatic backup copies the record
 * zip into it beside any other carrier.
 *
 * Expected behaviour: every run adds one timestamped zip and deletes nothing.
 * A folder that has gone out of reach is a failure the athlete has to act on,
 * and the other carriers carry on. Forgetting the carriers forgets the folder.
 */

import { Platform } from 'react-native';

import {
  forgetBackupCarrier,
  getBackupFailures,
  performBackup,
} from '@/features/settings/lib/autobackup';
import { failureMessageKey } from '@/features/settings/lib/autobackup/backends/errors';
import {
  folderBackend,
  forgetBackupFolder,
  getBackupFolderName,
  pickBackupFolder,
} from '@/features/settings/lib/autobackup/backends/folderBackend';

const RECORD_URI = 'file:///docs/veloq-decisions.zip';
const MOCK_ZIP_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 7, 7, 7]);
const TREE_URI = 'content://com.example.documents/tree/primary%3ATraining';
const IOS_FOLDER_URI = 'file:///private/var/mobile/Library/Mobile%20Documents/Training/';

const mockSettings = new Map<string, string>();
/** Every file on the device by uri, the record zip among them. */
const mockFiles = new Map<string, Uint8Array>();
/** The picked folder's contents by name, and whether it can still be reached. */
const mockFolder = { files: new Map<string, Uint8Array>(), reachable: true };
const mockPick = jest.fn<Promise<{ uri: string; name: string }>, []>();
const mockNative: Record<string, jest.Mock> = {};
const mockWebdavUpload = jest.fn(async (_path: string, _entry: unknown) => {});

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    getSetting: (key: string) => mockSettings.get(key),
    setSetting: (key: string, value: string) => mockSettings.set(key, value),
    deleteSetting: (key: string) => mockSettings.delete(key),
    engineInstall: () => 1,
    runRecordBackup: async (path: string) => {
      mockFiles.set(`file://${path}`, MOCK_ZIP_BYTES);
    },
  }),
}));

jest.mock('@/features/settings/lib/autobackup/backends/webdavBackend', () => ({
  webdavBackend: {
    id: 'webdav',
    name: 'WebDAV',
    isRemote: true,
    isAvailable: async () => true,
    listBackups: async () => [],
    upload: (path: string, entry: unknown) => mockWebdavUpload(path, entry),
    download: async () => {},
    delete: async () => {},
  },
  testWebdavConnection: jest.fn(),
}));

jest.mock('expo-network', () => ({
  ...jest.requireActual('expo-network'),
  getNetworkStateAsync: async () => ({ isConnected: true, isInternetReachable: true }),
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
    const bytes = mockFiles.get(uri);
    return bytes ? { exists: true, size: bytes.length } : { exists: false };
  },
}));

jest.mock('expo-file-system', () => {
  const TREE = 'content://com.example.documents/tree/primary%3ATraining';
  const unreachable = () => new Error('Permission Denial: no persisted grant');
  class MockFile {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    private get folderName(): string | null {
      return this.uri.startsWith(`${TREE}/`)
        ? decodeURIComponent(this.uri.slice(TREE.length + 1))
        : null;
    }
    get name(): string {
      return this.folderName ?? this.uri.split('/').pop()!;
    }
    get exists(): boolean {
      const name = this.folderName;
      return name !== null ? mockFolder.files.has(name) : mockFiles.has(this.uri);
    }
    get size(): number {
      const name = this.folderName;
      return (name !== null ? mockFolder.files.get(name) : mockFiles.get(this.uri))?.length ?? 0;
    }
    async bytes(): Promise<Uint8Array> {
      const name = this.folderName;
      const bytes = name !== null ? mockFolder.files.get(name) : mockFiles.get(this.uri);
      if (!bytes) throw new Error(`missing ${this.uri}`);
      return bytes;
    }
    write(content: Uint8Array): void {
      const name = this.folderName;
      if (name === null) {
        mockFiles.set(this.uri, content);
        return;
      }
      if (!mockFolder.reachable) throw unreachable();
      mockFolder.files.set(name, content);
    }
    delete(): void {
      const name = this.folderName;
      if (name !== null) mockFolder.files.delete(name);
      else mockFiles.delete(this.uri);
    }
    async copy(destination: MockFile): Promise<void> {
      destination.write(await this.bytes());
    }
  }
  class MockDirectory {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    static pickDirectoryAsync = async () => {
      const picked = await mockPick();
      const dir = new MockDirectory(picked.uri);
      Object.defineProperty(dir, 'name', { value: picked.name });
      return dir;
    };
    get name(): string {
      return 'Training';
    }
    get exists(): boolean {
      if (this.uri !== TREE) return false;
      if (!mockFolder.reachable) throw unreachable();
      return true;
    }
    list(): MockFile[] {
      if (!mockFolder.reachable) throw unreachable();
      return [...mockFolder.files.keys()].map(
        (n) => new MockFile(`${TREE}/${encodeURIComponent(n)}`)
      );
    }
    createFile(name: string, _mimeType: string | null): MockFile {
      if (!mockFolder.reachable) throw unreachable();
      mockFolder.files.set(name, new Uint8Array());
      return new MockFile(`${TREE}/${encodeURIComponent(name)}`);
    }
  }
  return { File: MockFile, Directory: MockDirectory };
});

const os = Platform.OS;
function onPlatform(platform: 'ios' | 'android'): void {
  Object.defineProperty(Platform, 'OS', { value: platform, configurable: true });
}

/** Whether `name` is a zip a run writes, and the instant it names. */
function stampOf(name: string): number | null {
  const m = name.match(/^veloq-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.zip$/);
  return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : null;
}

/** The native side's iOS folder, by bookmark: a revoked one throws as the module does. */
function installIosNative(): void {
  const unavailable = () =>
    Object.assign(new Error('The folder could not be resolved'), {
      code: 'ERR_FOLDER_UNAVAILABLE',
    });
  mockNative.bookmarkFolder = jest.fn((_uri: string) => 'Ym9va21hcmstMQ==');
  mockNative.writeToBookmarkedFolder = jest.fn((_bookmark: string, from: string, name: string) => {
    if (!mockFolder.reachable) throw unavailable();
    mockFolder.files.set(name, mockFiles.get(`file://${from}`)!);
    return { bookmark: 'Ym9va21hcmstMg==' };
  });
  mockNative.listBookmarkedFolder = jest.fn((_bookmark: string) => {
    if (!mockFolder.reachable) throw unavailable();
    return {
      files: [...mockFolder.files].map(([name, bytes]) => ({ name, size: bytes.length })),
      bookmark: null,
    };
  });
  mockNative.readFromBookmarkedFolder = jest.fn((_bookmark: string, name: string, to: string) => {
    if (!mockFolder.reachable) throw unavailable();
    mockFiles.set(`file://${to}`, mockFolder.files.get(name)!);
    return { bookmark: null };
  });
}

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-03-14T06:30:00.000Z'), doNotFake: ['nextTick'] });
  mockSettings.clear();
  mockFiles.clear();
  mockFolder.files.clear();
  mockFolder.reachable = true;
  mockWebdavUpload.mockClear();
  mockPick.mockReset();
  for (const key of Object.keys(mockNative)) delete mockNative[key];
  mockNative.releaseFolderGrant = jest.fn();
  mockSettings.set('__auto_backup_enabled', '1');
});

afterEach(() => {
  jest.useRealTimers();
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
});

describe('on Android, a storage-access folder', () => {
  beforeEach(async () => {
    onPlatform('android');
    mockPick.mockResolvedValue({ uri: TREE_URI, name: 'Training' });
    expect(await pickBackupFolder()).toBe('Training');
  });

  it('holds the picked folder and its name', async () => {
    expect(getBackupFolderName()).toBe('Training');
    expect(await folderBackend.isAvailable()).toBe(true);
  });

  it('gets one timestamped zip holding the platform zip bytes from a run', async () => {
    const result = await performBackup(true);

    expect(result.carriers.folder).toEqual({ status: 'written' });
    const names = [...mockFolder.files.keys()];
    expect(names).toHaveLength(1);
    expect(stampOf(names[0])).toBe(Date.parse('2026-03-14T06:30:00.000Z'));
    expect(mockFolder.files.get(names[0])).toEqual(MOCK_ZIP_BYTES);
  });

  it('keeps the first zip when a second run adds its own', async () => {
    await performBackup(true);
    jest.setSystemTime(new Date('2026-03-15T06:30:00.000Z'));
    await performBackup(true);

    const stamps = [...mockFolder.files.keys()].map(stampOf).sort();
    expect(stamps).toEqual([
      Date.parse('2026-03-14T06:30:00.000Z'),
      Date.parse('2026-03-15T06:30:00.000Z'),
    ]);
  });

  it('records the folder as out of reach when the grant is revoked, and WebDAV still uploads', async () => {
    mockFolder.reachable = false;

    const result = await performBackup(true);

    expect(result.carriers.folder).toEqual({ status: 'failed', kind: 'folder_unavailable' });
    expect(result.carriers.webdav).toEqual({ status: 'written' });
    expect(mockWebdavUpload).toHaveBeenCalledWith(RECORD_URI, expect.anything());
    expect(getBackupFailures().folder).toMatchObject({ kind: 'folder_unavailable' });
    expect(failureMessageKey('folder_unavailable')).toBe('backup.backupFailedFolder');
  });

  it('clears the failure once the folder takes a zip again', async () => {
    mockFolder.reachable = false;
    await performBackup(true);
    mockFolder.reachable = true;
    await performBackup(true);

    expect(getBackupFailures()).toEqual({});
  });

  it('forgets the folder and releases the grant with the carriers', async () => {
    forgetBackupCarrier();

    expect(mockSettings.has('__backup_folder')).toBe(false);
    expect(getBackupFolderName()).toBeNull();
    expect(await folderBackend.isAvailable()).toBe(false);
    expect(mockNative.releaseFolderGrant).toHaveBeenCalledWith(TREE_URI);
    expect((await performBackup(true)).carriers.folder).toEqual({
      status: 'skipped',
      reason: 'unavailable',
    });
  });

  it('lists the zips a run wrote, newest first, and nothing else', async () => {
    mockFolder.files.set('veloq-2026-01-02T08-00-00-000Z.zip', new Uint8Array(10));
    mockFolder.files.set('holiday.jpg', new Uint8Array(3));
    mockFolder.files.set('veloq-2026-02-03T09-15-00-250Z.zip', new Uint8Array(20));

    const entries = await folderBackend.listBackups();

    expect(entries.map((e) => [e.id, e.timestamp, e.sizeBytes])).toEqual([
      ['veloq-2026-02-03T09-15-00-250Z.zip', '2026-02-03T09:15:00.250Z', 20],
      ['veloq-2026-01-02T08-00-00-000Z.zip', '2026-01-02T08:00:00.000Z', 10],
    ]);
  });

  it('copies a listed zip out for restore', async () => {
    mockFolder.files.set('veloq-2026-01-02T08-00-00-000Z.zip', MOCK_ZIP_BYTES);

    await folderBackend.download('veloq-2026-01-02T08-00-00-000Z.zip', 'file:///cache/restore.zip');

    expect(mockFiles.get('file:///cache/restore.zip')).toEqual(MOCK_ZIP_BYTES);
  });

  it('keeps the held folder when the picker is dismissed', async () => {
    mockPick.mockRejectedValue(
      Object.assign(new Error('The file picker was cancelled by the user'), {
        code: 'ERR_PICKER_CANCELLED',
      })
    );

    expect(await pickBackupFolder()).toBeNull();
    expect(getBackupFolderName()).toBe('Training');
    expect(mockNative.releaseFolderGrant).not.toHaveBeenCalled();
  });

  it('releases the grant on the folder it replaces', async () => {
    const other = 'content://com.example.documents/tree/primary%3AOther';
    mockPick.mockResolvedValue({ uri: other, name: 'Other' });

    expect(await pickBackupFolder()).toBe('Other');
    expect(mockSettings.get('__backup_folder')).toBe(other);
    expect(mockNative.releaseFolderGrant).toHaveBeenCalledWith(TREE_URI);
  });

  it('never deletes a zip in the folder', async () => {
    await performBackup(true);
    const [name] = [...mockFolder.files.keys()];

    await expect(folderBackend.delete(name)).rejects.toThrow();
    expect(mockFolder.files.has(name)).toBe(true);
  });
});

describe('on iOS, a Files folder held by bookmark', () => {
  beforeEach(async () => {
    onPlatform('ios');
    installIosNative();
    mockPick.mockResolvedValue({ uri: IOS_FOLDER_URI, name: 'Training' });
    expect(await pickBackupFolder()).toBe('Training');
  });

  it('stores the bookmark made from the picked folder', () => {
    expect(mockNative.bookmarkFolder).toHaveBeenCalledWith(IOS_FOLDER_URI);
    expect(mockSettings.get('__backup_folder')).toBe('Ym9va21hcmstMQ==');
    expect(getBackupFolderName()).toBe('Training');
  });

  it('copies the zip in through the bookmark and keeps the one it refreshed', async () => {
    const result = await performBackup(true);

    expect(result.carriers.folder).toEqual({ status: 'written' });
    expect(mockNative.writeToBookmarkedFolder).toHaveBeenCalledWith(
      'Ym9va21hcmstMQ==',
      '/docs/veloq-decisions.zip',
      'veloq-2026-03-14T06-30-00-000Z.zip'
    );
    expect(mockFolder.files.get('veloq-2026-03-14T06-30-00-000Z.zip')).toEqual(MOCK_ZIP_BYTES);
    expect(mockSettings.get('__backup_folder')).toBe('Ym9va21hcmstMg==');
  });

  it('records a stale bookmark that will not resolve as out of reach, and WebDAV still uploads', async () => {
    mockFolder.reachable = false;

    const result = await performBackup(true);

    expect(result.carriers.folder).toEqual({ status: 'failed', kind: 'folder_unavailable' });
    expect(result.carriers.webdav).toEqual({ status: 'written' });
    expect(getBackupFailures().folder).toMatchObject({ kind: 'folder_unavailable' });
  });

  it('lists through the bookmark, newest first', async () => {
    mockFolder.files.set('veloq-2026-01-02T08-00-00-000Z.zip', new Uint8Array(10));
    mockFolder.files.set('notes.txt', new Uint8Array(1));
    mockFolder.files.set('veloq-2026-02-03T09-15-00-250Z.zip', new Uint8Array(20));

    const entries = await folderBackend.listBackups();

    expect(entries.map((e) => e.id)).toEqual([
      'veloq-2026-02-03T09-15-00-250Z.zip',
      'veloq-2026-01-02T08-00-00-000Z.zip',
    ]);
  });

  it('forgets the bookmark with the carriers and releases no Android grant', async () => {
    forgetBackupFolder();

    expect(mockSettings.has('__backup_folder')).toBe(false);
    expect(await folderBackend.isAvailable()).toBe(false);
    expect(mockNative.releaseFolderGrant).not.toHaveBeenCalled();
  });
});
