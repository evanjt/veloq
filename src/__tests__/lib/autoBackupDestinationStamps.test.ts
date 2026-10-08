/**
 * Scenario: the backup screen shows, on each destination, when it last
 * received a backup.
 * Expected behaviour: a run stamps the device backup when it writes the zip
 * and each carrier when that carrier takes it, and a stamp belongs to the
 * server or folder it was written to, so a new one starts with none.
 */

import {
  performBackup,
  getDestinationLastBackup,
  forgetBackupCarrier,
  type BackupBackend,
} from '@/features/settings/lib/autobackup';
import { BackupTransferError } from '@/features/settings/lib/autobackup/backends/errors';

const mockSettings = new Map<string, string>();
const mockCarriers: BackupBackend[] = [];
let mockWebdavUrl: string | null = 'https://dav.example.org/files/rider';
let mockFolderUri: string | null = 'content://tree/primary%3ALogbook';

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    getSetting: (key: string) => mockSettings.get(key),
    deleteSetting: (key: string) => mockSettings.delete(key),
    engineInstall: () => 1,
    setSetting: (key: string, value: string) => mockSettings.set(key, value),
    runRecordBackup: async () => {},
  }),
}));

jest.mock('@/features/settings/lib/autobackup/backends/carriers', () => ({
  get backupCarriers() {
    return mockCarriers;
  },
}));

jest.mock('@/features/settings/lib/autobackup/webdavConfig', () => ({
  ...jest.requireActual('@/features/settings/lib/autobackup/webdavConfig'),
  getWebdavConfig: () =>
    mockWebdavUrl ? { url: mockWebdavUrl, username: 'rider', password: 'pw' } : null,
}));

jest.mock('@/shared/native/backupFolder', () => ({
  ...jest.requireActual('@/shared/native/backupFolder'),
  heldBackupFolder: () => mockFolderUri,
  forgetBackupFolder: () => {
    mockFolderUri = null;
  },
}));

jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  documentDirectory: 'file:///docs/',
  getInfoAsync: jest.fn().mockResolvedValue({ exists: true, size: 4096 }),
}));

jest.mock('expo-network', () => ({
  ...jest.requireActual('expo-network'),
  getNetworkStateAsync: jest
    .fn()
    .mockResolvedValue({ isConnected: true, isInternetReachable: true }),
}));

function carrier(id: string, upload: BackupBackend['upload']): BackupBackend {
  return {
    id,
    name: id,
    isRemote: false,
    isAvailable: async () => true,
    listBackups: async () => [],
    upload,
    download: async () => {},
    delete: async () => {},
  };
}

const webdavUpload = jest.fn(async (_path: string, _entry: unknown) => {});
const folderUpload = jest.fn(async (_path: string, _entry: unknown) => {});
const RUN_AT = Date.parse('2026-05-04T06:30:00Z');

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(RUN_AT);
  mockSettings.clear();
  mockSettings.set('__auto_backup_enabled', '1');
  mockWebdavUrl = 'https://dav.example.org/files/rider';
  mockFolderUri = 'content://tree/primary%3ALogbook';
  webdavUpload.mockImplementation(async () => {});
  folderUpload.mockImplementation(async () => {});
  mockCarriers.length = 0;
  mockCarriers.push(carrier('webdav', webdavUpload), carrier('folder', folderUpload));
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('has no stamp on any destination before the first run', () => {
  expect(getDestinationLastBackup('device')).toBeNull();
  expect(getDestinationLastBackup('webdav')).toBeNull();
  expect(getDestinationLastBackup('folder')).toBeNull();
});

it('stamps the device backup and every carrier that took the zip', async () => {
  await performBackup(true);

  expect(getDestinationLastBackup('device')).toBe(RUN_AT);
  expect(getDestinationLastBackup('webdav')).toBe(RUN_AT);
  expect(getDestinationLastBackup('folder')).toBe(RUN_AT);
});

it('leaves a carrier that failed on its previous stamp while the others move on', async () => {
  await performBackup(true);
  const later = RUN_AT + 86_400_000;
  (Date.now as jest.Mock).mockReturnValue(later);
  webdavUpload.mockRejectedValue(new BackupTransferError('upload', 'auth', 'rejected', 401));

  await performBackup(true);

  expect(getDestinationLastBackup('webdav')).toBe(RUN_AT);
  expect(getDestinationLastBackup('folder')).toBe(later);
  expect(getDestinationLastBackup('device')).toBe(later);
});

it('shows no stamp for a WebDAV server or folder other than the one written to', async () => {
  await performBackup(true);

  mockWebdavUrl = 'https://dav.example.net/files/other';
  mockFolderUri = 'content://tree/primary%3AArchive';

  expect(getDestinationLastBackup('webdav')).toBeNull();
  expect(getDestinationLastBackup('folder')).toBeNull();
  expect(getDestinationLastBackup('device')).toBe(RUN_AT);
});

it('shows no stamp on a carrier that is no longer set up', async () => {
  await performBackup(true);

  mockWebdavUrl = null;
  mockFolderUri = null;

  expect(getDestinationLastBackup('webdav')).toBeNull();
  expect(getDestinationLastBackup('folder')).toBeNull();
});

it('forgets every stamp with the carriers', async () => {
  await performBackup(true);

  forgetBackupCarrier();
  mockWebdavUrl = 'https://dav.example.org/files/rider';
  mockFolderUri = 'content://tree/primary%3ALogbook';

  expect(getDestinationLastBackup('device')).toBeNull();
  expect(getDestinationLastBackup('webdav')).toBeNull();
  expect(getDestinationLastBackup('folder')).toBeNull();
});
