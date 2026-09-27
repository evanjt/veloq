/**
 * Scenario: a database copy takes over a second on a real library.
 * Expected behaviour: nothing waits for it on the JavaScript thread. The copy
 * runs in Rust and answers with a promise, so the export only shares, and the
 * auto-backup only uploads, once the copy has actually finished.
 */

import { exportDatabaseBackup } from '@/features/settings/lib/backup';
import { runDatabaseBackup } from '@/features/settings/lib/runBackup';
import {
  performBackup,
  registerBackend,
  type BackupBackend,
} from '@/features/settings/lib/autobackup';

const runBackup = jest.fn((_destPath: string) => Promise.resolve());
const mockSettings = new Map<string, string>();

// No backupDatabase: a call site still using the synchronous copy throws here.
const mockEngine = {
  runBackup,
  getSetting: (key: string) => mockSettings.get(key),
  setSetting: (key: string, value: string) => mockSettings.set(key, value),
  getBackupMetadata: () => ({ schema_version: '21', activity_count: '408', athlete_id: 'i1' }),
  destroyEngine: jest.fn(),
  getActivityCount: () => 408,
  notifyAll: jest.fn(),
};

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockEngine,
  getRouteDbPath: () => '/data/veloq.db',
  getNativeModule: () => ({}),
}));

jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  cacheDirectory: 'file:///cache/',
  getInfoAsync: jest.fn().mockResolvedValue({ exists: true, size: 4096 }),
  copyAsync: jest.fn().mockResolvedValue(undefined),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
  readDirectoryAsync: jest.fn().mockResolvedValue([]),
}));

const mockShareAsync = jest.fn().mockResolvedValue(undefined);
jest.mock('@/features/settings/lib/shareFile', () => ({
  shareExistingFile: (...args: unknown[]) => mockShareAsync(...args),
}));

jest.mock('@/shared/query/QueryProvider', () => ({
  queryClient: { invalidateQueries: jest.fn() },
}));

jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: { getState: () => ({ athleteId: 'i1' }) },
}));

/** A copy that lands after the caller has had a chance to do something else. */
function landsOnALaterTick(): void {
  runBackup.mockImplementation(() => new Promise<void>((resolve) => setImmediate(resolve)));
}

const upload = jest.fn();
const uploadBackend: BackupBackend = {
  id: 'test-remote',
  name: 'Test Remote',
  isRemote: false,
  isAvailable: async () => true,
  listBackups: async () => [],
  upload: (localPath, metadata) => upload(localPath, metadata),
  download: async () => {},
  delete: async () => {},
};
registerBackend(uploadBackend);

beforeEach(() => {
  runBackup.mockReset();
  runBackup.mockResolvedValue(undefined);
  mockShareAsync.mockClear();
  upload.mockReset();
  mockSettings.clear();
  mockSettings.set('__backup_backend', 'test-remote');
});

describe('exportDatabaseBackup', () => {
  it('starts the copy in Rust and shares only once it has finished', async () => {
    let shared = false;
    landsOnALaterTick();
    mockShareAsync.mockImplementation(() => {
      shared = true;
      return Promise.resolve();
    });

    const exporting = exportDatabaseBackup();
    expect(shared).toBe(false);
    await exporting;

    expect(runBackup).toHaveBeenCalledTimes(1);
    expect(runBackup.mock.calls[0][0]).toMatch(/^\/cache\/veloq-backup-.*\.veloqdb$/);
    expect(mockShareAsync).toHaveBeenCalledTimes(1);
  });

  it('does not share a copy that failed', async () => {
    runBackup.mockRejectedValue(new Error('Backup failed: disk full'));

    await expect(exportDatabaseBackup()).rejects.toThrow('disk full');
    expect(mockShareAsync).not.toHaveBeenCalled();
  });

  it('runs a second export after the first has finished', async () => {
    await exportDatabaseBackup();
    await exportDatabaseBackup();

    expect(runBackup).toHaveBeenCalledTimes(2);
    expect(mockShareAsync).toHaveBeenCalledTimes(2);
  });

  it('does not share when a copy is already running', async () => {
    runBackup.mockRejectedValue(new Error('A backup is already running'));

    await expect(exportDatabaseBackup()).rejects.toThrow('already running');
    expect(mockShareAsync).not.toHaveBeenCalled();
  });
});

describe('runDatabaseBackup', () => {
  it('carries the engine failure through, message intact', async () => {
    runBackup.mockRejectedValue(new Error('Backup thread died without a result'));

    await expect(runDatabaseBackup(mockEngine, '/cache/out.veloqdb')).rejects.toThrow(
      /died without a result/
    );
  });

  it('leaves the JS thread free while the copy runs', async () => {
    landsOnALaterTick();
    let ranWhileCopying = false;

    const pending = runDatabaseBackup(mockEngine, '/cache/out.veloqdb');
    ranWhileCopying = true;

    await expect(pending).resolves.toBe('complete');
    expect(ranWhileCopying).toBe(true);
  });
});

describe('performBackup', () => {
  it('uploads only after the copy has finished', async () => {
    let copied = false;
    runBackup.mockImplementation(
      () =>
        new Promise<void>((resolve) =>
          setImmediate(() => {
            copied = true;
            resolve();
          })
        )
    );
    let copiedWhenUploaded = false;
    upload.mockImplementation(() => {
      copiedWhenUploaded = copied;
      return Promise.resolve();
    });

    await expect(performBackup(true)).resolves.toBe(true);

    expect(runBackup).toHaveBeenCalledTimes(1);
    expect(copiedWhenUploaded).toBe(true);
  });
});
