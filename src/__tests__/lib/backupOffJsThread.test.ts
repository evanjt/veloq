/**
 * Scenario: a database copy takes over a second on a real library.
 * Expected behaviour: nothing waits for it on the JavaScript thread. The copy
 * is started in Rust and polled, so the export only shares, and the auto-backup
 * only uploads, once the copy has actually finished.
 */

import { exportDatabaseBackup } from '@/features/settings/lib/backup';
import { runDatabaseBackup } from '@/features/settings/lib/runBackup';
import {
  performBackup,
  registerBackend,
  type BackupBackend,
} from '@/features/settings/lib/autobackup';

const startBackup = jest.fn();
const pollBackup = jest.fn();
const mockSettings = new Map<string, string>();

// No backupDatabase: a call site still using the synchronous copy throws here.
const mockEngine = {
  startBackup,
  pollBackup,
  getSetting: (key: string) => mockSettings.get(key),
  setSetting: (key: string, value: string) => mockSettings.set(key, value),
  getBackupMetadata: () => ({ schema_version: '21', activity_count: '408', athlete_id: 'i1' }),
  destroyEngine: jest.fn(),
  getActivityCount: () => 408,
  notifyAll: jest.fn(),
};

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockEngine,
  getRouteDbPath: () => '/data/veloq.db',
  getNativeModule: () => ({}),
}));

jest.mock('expo-file-system/legacy', () => ({
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

/** Report the copy as running for `ticks` polls, then complete. */
function completesAfter(ticks: number): void {
  let seen = 0;
  pollBackup.mockImplementation(() => {
    seen += 1;
    return seen > ticks ? 'complete' : 'running';
  });
}

const upload = jest.fn();
const uploadBackend: BackupBackend = {
  id: 'test-remote',
  name: 'Test Remote',
  isAvailable: async () => true,
  listBackups: async () => [],
  upload: (localPath, metadata) => upload(localPath, metadata),
  download: async () => {},
  delete: async () => {},
};
registerBackend(uploadBackend);

beforeEach(() => {
  startBackup.mockReset();
  pollBackup.mockReset();
  mockShareAsync.mockClear();
  upload.mockReset();
  mockSettings.clear();
  mockSettings.set('__backup_backend', 'test-remote');
});

describe('exportDatabaseBackup', () => {
  it('starts the copy in Rust and shares only once it has finished', async () => {
    completesAfter(2);

    await exportDatabaseBackup();

    expect(startBackup).toHaveBeenCalledTimes(1);
    expect(startBackup.mock.calls[0][0]).toMatch(/^\/cache\/veloq-backup-.*\.veloqdb$/);
    expect(pollBackup).toHaveBeenCalledTimes(3);
    expect(mockShareAsync).toHaveBeenCalledTimes(1);
  });

  it('does not share a copy that failed', async () => {
    pollBackup.mockImplementation(() => {
      throw new Error('Backup failed: disk full');
    });

    await expect(exportDatabaseBackup()).rejects.toThrow('disk full');
    expect(mockShareAsync).not.toHaveBeenCalled();
  });

  it('runs a second export after the first has finished', async () => {
    completesAfter(0);
    await exportDatabaseBackup();
    completesAfter(0);
    await exportDatabaseBackup();

    expect(startBackup).toHaveBeenCalledTimes(2);
    expect(mockShareAsync).toHaveBeenCalledTimes(2);
  });

  it('does not share when a copy is already running', async () => {
    startBackup.mockImplementation(() => {
      throw new Error('A backup is already running');
    });

    await expect(exportDatabaseBackup()).rejects.toThrow('already running');
    expect(pollBackup).not.toHaveBeenCalled();
    expect(mockShareAsync).not.toHaveBeenCalled();
  });
});

describe('runDatabaseBackup', () => {
  it('rejects when the copy vanishes before it completes', async () => {
    pollBackup.mockReturnValue('idle');

    await expect(runDatabaseBackup(mockEngine, '/cache/out.veloqdb')).rejects.toThrow(
      /without finishing/
    );
  });

  it('yields between polls instead of spinning', async () => {
    completesAfter(1);

    const pending = runDatabaseBackup(mockEngine, '/cache/out.veloqdb');
    expect(pollBackup).not.toHaveBeenCalled();

    await pending;
    expect(pollBackup).toHaveBeenCalledTimes(2);
  });
});

describe('performBackup', () => {
  it('uploads only after the copy has finished', async () => {
    completesAfter(2);
    let polledWhenUploaded = 0;
    upload.mockImplementation(() => {
      polledWhenUploaded = pollBackup.mock.calls.length;
      return Promise.resolve();
    });

    await expect(performBackup(true)).resolves.toBe(true);

    expect(startBackup).toHaveBeenCalledTimes(1);
    expect(polledWhenUploaded).toBe(3);
  });
});
