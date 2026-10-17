/**
 * Scenario: an empty library on a phone where backups can be seen in several
 * places at once: the device backup's record zip, a WebDAV server and Google
 * Drive.
 *
 * Expected behaviour: the offer names the one backup it would restore, the
 * newest of all of them, with where it was found, so the card can say what it
 * found rather than that nothing was. With nothing anywhere it finds nothing.
 */

import { findNewestBackup } from '@/features/settings/lib/restorePrompt';

let mockRecord: { exists: boolean; size?: number; modificationTime?: number } = { exists: false };
let mockRecordRefused = false;
let mockRecordWrittenAt: string | null = null;
let mockWebdav: unknown[] = [];
let mockDrive: unknown[] = [];
let mockWebdavConfigured = true;

jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  getInfoAsync: async () => mockRecord,
}));
jest.mock('@/shared/storage/platformRecord', () => ({
  platformRecordUri: () => 'file:///docs/veloq-decisions.zip',
}));
jest.mock('@/features/settings/lib/backup', () => ({
  checkRecordBackup: async () => {
    if (mockRecordRefused) throw new Error('another athlete');
    return mockRecordWrittenAt;
  },
}));
jest.mock('@/features/settings/lib/autobackup/webdavConfig', () => ({
  initWebdavConfig: async () => {},
  getWebdavConfig: () => (mockWebdavConfigured ? { url: 'https://example.invalid/dav' } : null),
}));
jest.mock('@/features/settings/lib/autobackup/backends', () => ({
  webdavBackend: { id: 'webdav', listBackups: async () => mockWebdav },
  googleDriveBackend: {
    id: 'google-drive',
    isAvailable: async () => true,
    listBackups: async () => mockDrive,
  },
  icloudBackend: { id: 'icloud', listBackups: async () => [] },
  isIcloudSupported: () => false,
}));
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({ getSetting: () => null, setSetting: () => {} }),
}));

const entry = (id: string, timestamp: string) => ({
  id,
  timestamp,
  sizeBytes: 2_400_000,
  appVersion: '0.4.0',
});

beforeEach(() => {
  mockRecord = { exists: true, size: 1_200_000, modificationTime: Date.UTC(2026, 5, 1) / 1000 };
  mockRecordRefused = false;
  mockRecordWrittenAt = null;
  mockWebdav = [
    entry('dav-new.zip', '2026-06-08T06:30:00.000Z'),
    entry('dav-old.zip', '2026-05-01T06:30:00.000Z'),
  ];
  mockDrive = [entry('drive.zip', '2026-06-04T18:10:00.000Z')];
  mockWebdavConfigured = true;
});

describe('the newest backup the restore offer names', () => {
  it('is the newest across the record zip, WebDAV and Google Drive, with its source', async () => {
    const found = await findNewestBackup();
    expect(found?.source).toBe('webdav');
    expect(found?.entry.id).toBe('dav-new.zip');
    expect(found?.backend?.id).toBe('webdav');
  });

  it('names Google Drive when its backup is the newest', async () => {
    mockDrive = [entry('drive.zip', '2026-06-09T18:10:00.000Z')];
    const found = await findNewestBackup();
    expect(found?.source).toBe('googleDrive');
    expect(found?.entry.id).toBe('drive.zip');
  });

  it('names the device backup when its record zip is the newest, with its size and time', async () => {
    mockRecord = { exists: true, size: 1_200_000, modificationTime: Date.UTC(2026, 6, 1) / 1000 };
    const found = await findNewestBackup();
    expect(found?.source).toBe('device');
    expect(found?.backend).toBeNull();
    expect(found?.entry.sizeBytes).toBe(1_200_000);
    expect(found?.entry.timestamp).toBe('2026-07-01T00:00:00.000Z');
  });

  it('dates the device backup from the time its record says it was written', async () => {
    // The platform's restore rewrites the file time: the original seconds read
    // as milliseconds, a date in January 1970.
    mockRecord = { exists: true, size: 1_200_000, modificationTime: 1_790_856 };
    mockRecordWrittenAt = '2026-10-01T12:00:00.000Z';
    mockWebdav = [entry('dav.zip', '2026-09-30T06:30:00.000Z')];
    mockDrive = [];
    const found = await findNewestBackup();
    expect(found?.source).toBe('device');
    expect(found?.entry.timestamp).toBe('2026-10-01T12:00:00.000Z');
  });

  it('dates a record that names no time from its file', async () => {
    mockRecord = { exists: true, size: 1_200_000, modificationTime: Date.UTC(2026, 6, 1) / 1000 };
    mockRecordWrittenAt = null;
    const found = await findNewestBackup();
    expect(found?.source).toBe('device');
    expect(found?.entry.timestamp).toBe('2026-07-01T00:00:00.000Z');
  });

  it('skips a record zip the engine would refuse to restore', async () => {
    mockWebdav = [];
    mockDrive = [];
    mockRecord = { exists: true, size: 1_200_000, modificationTime: Date.UTC(2026, 6, 1) / 1000 };
    mockRecordRefused = true;
    await expect(findNewestBackup()).resolves.toBeNull();
  });

  it('is null when nothing is found anywhere', async () => {
    mockRecord = { exists: false };
    mockWebdav = [];
    mockDrive = [];
    await expect(findNewestBackup()).resolves.toBeNull();
  });

  it('still finds Drive when WebDAV is not set up', async () => {
    mockWebdavConfigured = false;
    mockRecord = { exists: false };
    const found = await findNewestBackup();
    expect(found?.source).toBe('googleDrive');
  });
});
