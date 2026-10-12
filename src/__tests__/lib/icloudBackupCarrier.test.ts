/**
 * Scenario: on an iPhone, automatic backup copies the record zip into Veloq's own folder in the
 * athlete's iCloud Drive, with nothing to set up. Veloq is later deleted and installed again, and
 * the container's files are listed before any of them is on the phone.
 *
 * Expected behaviour: a run writes one zip under `/Veloq` in the Documents scope, reads it back
 * and stamps the destination, and each run adds another without deleting one. The restore list
 * finds them newest first, waiting for iCloud to answer, and a backup not yet on the phone is
 * fetched before it is copied. The athlete can turn the destination off, an iPhone signed out of
 * iCloud is told so rather than skipped in silence, and forgetting the carriers forgets the switch
 * and never a file. On Android the carrier does not exist.
 */

import { Platform } from 'react-native';

import {
  forgetBackupCarrier,
  getBackupFailures,
  getDestinationLastBackup,
  icloudBackupState,
  isIcloudBackupOn,
  performBackup,
  setIcloudBackupOn,
} from '@/features/settings/lib/autobackup';
import { icloudBackend } from '@/features/settings/lib/autobackup/backends/icloudBackend';

const MOCK_ZIP_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 7, 7, 7, 7]);
const BACKUP_NAME = /^veloq-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.zip$/;

const mockSettings = new Map<string, string>();
/** Every file on the device by uri, the record zip among them. */
const mockFiles = new Map<string, Uint8Array>();

/**
 * Veloq's iCloud container as the cloud-storage module shows it. A file the container holds is
 * on the phone only once it was written here or fetched, as after a reinstall.
 */
const mockCloud = {
  available: true,
  /** Answers `isCloudAvailable` gives, in order, before it settles on `available`. */
  availability: [] as boolean[],
  scope: null as string | null,
  dirs: new Set<string>(),
  files: new Map<string, Uint8Array>(),
  onDevice: new Set<string>(),
  /** Whether a write keeps only part of the bytes. */
  truncates: false,
  unlinks: [] as string[],
  calls: [] as string[],
};

function mockCloudError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

function mockParent(path: string): string {
  return path.slice(0, path.lastIndexOf('/')) || '/';
}

jest.mock('react-native-cloud-storage', () => ({
  ...jest.requireActual('react-native-cloud-storage'),
  CloudStorageScope: { Documents: 'documents', AppData: 'app_data' },
  CloudStorage: {
    setProviderOptions: (options: { scope?: string }) => {
      mockCloud.scope = options.scope ?? null;
    },
    isCloudAvailable: async () => {
      mockCloud.calls.push('isCloudAvailable');
      const next = mockCloud.availability.shift();
      return next ?? mockCloud.available;
    },
    exists: async (path: string) => mockCloud.dirs.has(path) || mockCloud.files.has(path),
    mkdir: async (path: string) => {
      mockCloud.dirs.add(path);
    },
    readdir: async (path: string) => {
      mockCloud.calls.push(`readdir ${path}`);
      if (!mockCloud.dirs.has(path)) {
        throw mockCloudError(`no directory ${path}`, 'ERR_DIRECTORY_NOT_FOUND');
      }
      return [...mockCloud.files.keys()]
        .filter((file) => mockParent(file) === path)
        .map((file) => file.slice(path.length + 1));
    },
    stat: async (path: string) => {
      const bytes = mockCloud.files.get(path);
      if (!bytes) throw mockCloudError(`no file ${path}`, 'ERR_FILE_NOT_FOUND');
      return { size: bytes.length, isFile: () => true, isDirectory: () => false };
    },
    uploadFile: async (remote: string, local: string, options: { mimeType: string }) => {
      expect(options.mimeType).toBe('application/zip');
      const bytes = mockFiles.get(`file://${local}`);
      if (!bytes) throw mockCloudError(`missing ${local}`, 'ERR_FILE_NOT_FOUND');
      if (mockCloud.files.has(remote)) throw mockCloudError(remote, 'ERR_FILE_EXISTS');
      mockCloud.dirs.add(mockParent(remote));
      mockCloud.files.set(remote, mockCloud.truncates ? bytes.slice(0, bytes.length - 2) : bytes);
      mockCloud.onDevice.add(remote);
    },
    triggerSync: async (path: string) => {
      mockCloud.calls.push(`triggerSync ${path}`);
      if (!mockCloud.files.has(path)) throw mockCloudError(path, 'ERR_FILE_NOT_FOUND');
      mockCloud.onDevice.add(path);
    },
    downloadFile: async (remote: string, local: string, scope: string) => {
      expect(scope).toBe('documents');
      const bytes = mockCloud.files.get(remote);
      if (!bytes) throw mockCloudError(remote, 'ERR_FILE_NOT_FOUND');
      if (!mockCloud.onDevice.has(remote))
        throw mockCloudError(remote, 'ERR_FILE_NOT_DOWNLOADABLE');
      if (mockFiles.has(`file://${local}`)) throw mockCloudError(local, 'ERR_FILE_EXISTS');
      mockFiles.set(`file://${local}`, bytes);
    },
    unlink: async (path: string) => {
      mockCloud.unlinks.push(path);
      mockCloud.files.delete(path);
    },
  },
}));

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

/** A carrier the athlete has not set up, standing in for the others. */
function mockUnsetCarrier(id: string) {
  return {
    id,
    name: id,
    isRemote: false,
    isAvailable: async () => false,
    listBackups: async () => [],
    upload: async () => '',
    download: async () => {},
    delete: async () => {},
  };
}

jest.mock('@/features/settings/lib/autobackup/backends/folderBackend', () => ({
  folderBackend: mockUnsetCarrier('folder'),
  forgetBackupFolder: () => {},
  pickBackupFolder: async () => null,
  getBackupFolderName: () => null,
}));

jest.mock('@/features/settings/lib/autobackup/backends/webdavBackend', () => ({
  webdavBackend: mockUnsetCarrier('webdav'),
  testWebdavConnection: async () => ({ kind: 'ok' }),
}));

jest.mock('@/features/settings/lib/autobackup/backends/googleDriveBackend', () => ({
  googleDriveBackend: mockUnsetCarrier('googleDrive'),
  forgetGoogleDrive: async () => {},
  signInToGoogleDrive: async () => null,
  getGoogleDriveAccount: () => null,
  loadGoogleDriveAccount: async () => null,
  isGoogleDriveSupported: () => false,
}));

jest.mock('expo-network', () => ({
  ...jest.requireActual('expo-network'),
  getNetworkStateAsync: async () => ({ isConnected: true, isInternetReachable: true }),
}));

jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  documentDirectory: 'file:///docs/',
  cacheDirectory: 'file:///cache/',
  makeDirectoryAsync: async () => undefined,
  deleteAsync: async (uri: string) => {
    mockFiles.delete(uri);
  },
  getInfoAsync: async (uri: string) => {
    const bytes = mockFiles.get(uri);
    return bytes ? { exists: true, size: bytes.length } : { exists: false };
  },
}));

// expo-crypto needs a native module at import, so the copy a run reads back is
// hashed here from the files above.
jest.mock('@/features/settings/lib/autobackup/zipFingerprint', () => ({
  zipFingerprint: async (uri: string) => {
    const bytes = mockFiles.get(uri);
    if (!bytes) throw new Error(`missing ${uri}`);
    const sha256 = jest
      .requireActual<typeof import('crypto')>('crypto')
      .createHash('sha256')
      .update(bytes)
      .digest('hex');
    return { sha256, size: bytes.length };
  },
}));

const os = Platform.OS;

function onPlatform(platform: 'ios' | 'android'): void {
  Object.defineProperty(Platform, 'OS', { value: platform, configurable: true });
}

function containerFiles(): string[] {
  return [...mockCloud.files.keys()];
}

beforeEach(() => {
  mockSettings.clear();
  mockFiles.clear();
  mockCloud.available = true;
  mockCloud.availability = [];
  mockCloud.dirs.clear();
  mockCloud.files.clear();
  mockCloud.onDevice.clear();
  mockCloud.truncates = false;
  mockCloud.unlinks = [];
  mockCloud.calls = [];
  mockSettings.set('__auto_backup_enabled', '1');
});

afterEach(() => {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
});

describe('on iPhone', () => {
  beforeEach(() => onPlatform('ios'));

  it('is on with nothing set up', async () => {
    expect(isIcloudBackupOn()).toBe(true);
    expect(await icloudBackend.isAvailable()).toBe(true);
    expect(await icloudBackupState()).toBe('ready');
  });

  it('writes one zip under /Veloq from a run, reads it back and stamps it', async () => {
    const result = await performBackup(true);

    expect(result.carriers.icloud).toEqual({ status: 'written' });
    const files = containerFiles();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^\/Veloq\//);
    expect(files[0].slice('/Veloq/'.length)).toMatch(BACKUP_NAME);
    expect(mockCloud.files.get(files[0])).toEqual(MOCK_ZIP_BYTES);
    expect(mockCloud.scope).toBe('documents');
    expect(getDestinationLastBackup('icloud')).not.toBeNull();
    expect(getBackupFailures()).toEqual({});
  });

  it('adds a zip on every run and deletes none', async () => {
    await performBackup(true);
    jest.setSystemTime(Date.now() + 1000);
    await performBackup(true);

    expect(containerFiles()).toHaveLength(2);
    expect(mockCloud.unlinks).toEqual([]);
    await expect(icloudBackend.delete(containerFiles()[0])).rejects.toThrow();
    expect(containerFiles()).toHaveLength(2);
  });

  it('reports a copy that did not read back the same as unverified and owes it', async () => {
    mockCloud.truncates = true;

    const result = await performBackup(true);

    expect(result.carriers.icloud).toEqual({ status: 'failed', kind: 'unverified' });
    expect(getDestinationLastBackup('icloud')).toBeNull();
    expect(JSON.parse(mockSettings.get('__backup_owed_carriers') ?? '[]')).toEqual(['icloud']);
  });

  it('lists the zips runs wrote, newest first, and restores one by its listed id', async () => {
    await performBackup(true);
    jest.setSystemTime(Date.now() + 1000);
    await performBackup(true);
    mockCloud.files.set('/Veloq/notes.txt', new Uint8Array([1]));

    const entries = await icloudBackend.listBackups();

    expect(entries).toHaveLength(2);
    expect(entries[0].id).toMatch(BACKUP_NAME);
    expect(new Date(entries[0].timestamp).getTime()).toBeGreaterThan(
      new Date(entries[1].timestamp).getTime()
    );
    expect(entries[0].sizeBytes).toBe(MOCK_ZIP_BYTES.length);

    await icloudBackend.download(entries[1].id, 'file:///cache/restore.zip');
    expect(mockFiles.get('file:///cache/restore.zip')).toEqual(MOCK_ZIP_BYTES);
  });

  it('after a reinstall, waits for iCloud, lists the container and fetches a zip not yet on the phone', async () => {
    const name = 'veloq-2026-06-10T08-00-00-000Z.zip';
    const older = 'veloq-2026-06-03T08-00-00-000Z.zip';
    mockCloud.dirs.add('/Veloq');
    mockCloud.files.set(`/Veloq/${name}`, MOCK_ZIP_BYTES);
    mockCloud.files.set(`/Veloq/${older}`, MOCK_ZIP_BYTES);
    mockCloud.availability = [false, false];

    const entries = await icloudBackend.listBackups();

    expect(entries.map((entry) => entry.id)).toEqual([name, older]);
    expect(entries[0].timestamp).toBe('2026-06-10T08:00:00.000Z');
    expect(mockCloud.calls.indexOf('readdir /Veloq')).toBeGreaterThan(
      mockCloud.calls.lastIndexOf('isCloudAvailable')
    );

    await icloudBackend.download(name, 'file:///cache/restore.zip');
    expect(mockCloud.calls).toContain(`triggerSync /Veloq/${name}`);
    expect(mockFiles.get('file:///cache/restore.zip')).toEqual(MOCK_ZIP_BYTES);
  });

  it('lists nothing from a container no run has written to', async () => {
    await expect(icloudBackend.listBackups()).resolves.toEqual([]);
  });

  it('replaces a copy a failed restore left behind rather than refusing it', async () => {
    await performBackup(true);
    const [entry] = await icloudBackend.listBackups();
    mockFiles.set('file:///cache/restore.zip', new Uint8Array([9]));

    await icloudBackend.download(entry.id, 'file:///cache/restore.zip');

    expect(mockFiles.get('file:///cache/restore.zip')).toEqual(MOCK_ZIP_BYTES);
  });

  it('skips a run while the athlete has turned it off', async () => {
    setIcloudBackupOn(false);

    const result = await performBackup(true);

    expect(isIcloudBackupOn()).toBe(false);
    expect(await icloudBackupState()).toBe('off');
    expect(result.carriers.icloud).toEqual({ status: 'skipped', reason: 'unavailable' });
    expect(containerFiles()).toEqual([]);
    expect(getDestinationLastBackup('icloud')).toBeNull();
  });

  it('says why when the iPhone is signed out of iCloud or iCloud Drive is off for Veloq', async () => {
    mockCloud.available = false;

    expect(await icloudBackupState()).toBe('unavailable');
    const result = await performBackup(true);

    expect(result.carriers.icloud).toEqual({ status: 'skipped', reason: 'unavailable' });
    expect(containerFiles()).toEqual([]);
    await expect(icloudBackend.listBackups()).rejects.toThrow();
  });

  it('forgets the switch with the carriers and leaves every file in iCloud', async () => {
    await performBackup(true);
    setIcloudBackupOn(false);

    forgetBackupCarrier();

    expect(isIcloudBackupOn()).toBe(true);
    expect(getDestinationLastBackup('icloud')).toBeNull();
    expect(containerFiles()).toHaveLength(1);
    expect(mockCloud.unlinks).toEqual([]);
  });
});

describe('on Android', () => {
  beforeEach(() => onPlatform('android'));

  it('has no iCloud carrier and lists nothing', async () => {
    expect(await icloudBackend.isAvailable()).toBe(false);
    expect(await icloudBackupState()).toBe('unsupported');
    await expect(icloudBackend.listBackups()).resolves.toEqual([]);

    const result = await performBackup(true);

    expect(result.carriers.icloud).toEqual({ status: 'skipped', reason: 'unavailable' });
    expect(containerFiles()).toEqual([]);
    expect(mockCloud.calls).toEqual([]);
  });
});
