/**
 * Scenario: a backup destination rejects the upload.
 * Expected behaviour: the last-backup timestamp stays where it was, so the 24h
 * throttle cannot hide a failure for a day, and a failure the user has to act
 * on is kept for the settings screen to read.
 */

import {
  performBackup,
  getLastBackupTimestamp,
  getLastBackupFailure,
  getBackupFailures,
  type BackupBackend,
} from '@/features/settings/lib/autobackup';
import * as FileSystem from 'expo-file-system/legacy';
import {
  transferFailure,
  transportFailure,
} from '@/features/settings/lib/autobackup/backends/errors';

const mockSettings = new Map<string, string>();
const mockRunRecordBackup = jest.fn();

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides(
    require('../__shared__/veloqrsStub').namespacesOver(() =>
      require('@/shared/native/engine').getEngine()
    )
  )
);
jest.mock('@/shared/native/engine', () => ({
  isEngineReady: () => true,
  getEngine: () => ({
    getSetting: (key: string) => mockSettings.get(key),
    engineInstall: () => 1,
    setSetting: (key: string, value: string) => mockSettings.set(key, value),
    runRecordBackup: (...args: unknown[]) => mockRunRecordBackup(...args),
    getBackupMetadata: () => ({
      schema_version: '14',
      activity_count: '312',
      athlete_id: 'i12345',
    }),
  }),
}));

jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  cacheDirectory: 'file:///cache/',
  documentDirectory: 'file:///docs/',
  getInfoAsync: jest.fn().mockResolvedValue({ exists: true, size: 4096 }),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
}));

const upload = jest.fn();

// The stub carriers keep nothing, so every copy they hand back reads as the zip sent.
jest.mock('@/features/settings/lib/autobackup/zipFingerprint', () => ({
  ...jest.requireActual('@/features/settings/lib/autobackup/zipFingerprint'),
  zipFingerprint: async () => ({ sha256: '00', size: 4096 }),
}));

const testBackend: BackupBackend = {
  id: 'test-remote',
  name: 'Test Remote',
  isRemote: false,
  isAvailable: async () => true,
  listBackups: async () => [],
  upload: (localPath, metadata) => upload(localPath, metadata),
  download: async () => {},
  putObject: async () => {},
  listObjects: async () => [],
  fetchObject: async () => {},
};

const mockCarriers: BackupBackend[] = [testBackend];
jest.mock('@/features/settings/lib/autobackup/backends/carriers', () => ({
  get backupCarriers() {
    return mockCarriers;
  },
}));

beforeEach(() => {
  mockSettings.clear();
  upload.mockReset();
  mockRunRecordBackup.mockReset().mockResolvedValue(undefined);
});

describe('performBackup', () => {
  it('records an address failure for a switched-on carrier whose address is refused', async () => {
    const refused: BackupBackend = {
      ...testBackend,
      id: 'test-refused',
      isAvailable: async () => false,
      addressProblem: () => true,
    };
    mockCarriers.push(refused);
    try {
      const result = await performBackup(true);

      expect(result).toMatchObject({
        carriers: { 'test-refused': { status: 'failed', kind: 'address' } },
      });
      expect(getLastBackupFailure()).toMatchObject({ kind: 'address' });
    } finally {
      mockCarriers.pop();
    }
  });

  it('leaves the last-backup timestamp alone when the upload is rejected', async () => {
    upload.mockRejectedValue(transferFailure('Upload backup', 401));

    await expect(performBackup(true)).resolves.toMatchObject({ wroteZip: true });

    expect(getLastBackupTimestamp()).toBeNull();
    expect(getLastBackupFailure()).toMatchObject({ kind: 'auth', status: 401 });
  });

  it('does not overwrite an older timestamp on a later failure', async () => {
    mockSettings.set('__last_auto_backup', '1000');
    upload.mockRejectedValue(transferFailure('Upload backup', 507));

    await expect(performBackup(true)).resolves.toMatchObject({ wroteZip: true });

    expect(getLastBackupTimestamp()).toBe(1000);
    expect(getLastBackupFailure()?.kind).toBe('quota');
  });

  it('keeps quiet about a transient failure', async () => {
    upload.mockRejectedValue(transportFailure('Upload backup', new Error('socket hang up')));

    await expect(performBackup(true)).resolves.toMatchObject({ wroteZip: true });

    expect(getLastBackupFailure()).toBeNull();
  });

  it('records the timestamp and clears a standing failure on success', async () => {
    mockSettings.set('__last_backup_failure', JSON.stringify({ kind: 'auth', status: 401, at: 5 }));
    upload.mockResolvedValue('veloq-backup.zip');

    await expect(performBackup(true)).resolves.toMatchObject({ wroteZip: true });

    expect(getLastBackupTimestamp()).toBeGreaterThan(0);
    expect(getLastBackupFailure()).toBeNull();
  });

  it('records a device failure when the engine cannot write the record archive', async () => {
    mockRunRecordBackup.mockRejectedValue(new Error('no space left on device'));

    await expect(performBackup(true)).rejects.toThrow('no space left on device');

    expect(getBackupFailures().device).toMatchObject({ kind: 'device' });
    expect(getLastBackupTimestamp()).toBeNull();
  });

  it('records a device failure when the archive is not there afterwards', async () => {
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValueOnce({ exists: false });

    await expect(performBackup(true)).rejects.toThrow('Record archive was not created');

    expect(getBackupFailures().device).toMatchObject({ kind: 'device' });
  });

  it('clears the device failure when a later run writes the archive', async () => {
    mockRunRecordBackup.mockRejectedValueOnce(new Error('no space left on device'));
    await expect(performBackup(true)).rejects.toThrow();
    expect(getBackupFailures().device).toBeDefined();
    upload.mockResolvedValue('veloq-backup.zip');

    await expect(performBackup(true)).resolves.toMatchObject({ wroteZip: true });

    expect(getBackupFailures().device).toBeUndefined();
  });

  it('keeps a carrier failure when the device failure clears', async () => {
    mockSettings.set(
      '__last_backup_failure',
      JSON.stringify({
        device: { kind: 'device', status: null, at: 5 },
        'test-remote': { kind: 'auth', status: 401, at: 6 },
      })
    );
    upload.mockRejectedValue(transferFailure('Upload backup', 401));

    await performBackup(true);

    expect(Object.keys(getBackupFailures())).toEqual(['test-remote']);
  });

  it('keeps a standing device failure when the run is skipped', async () => {
    mockRunRecordBackup.mockRejectedValueOnce(new Error('no space left on device'));
    await expect(performBackup(true)).rejects.toThrow();
    mockSettings.set('__auto_backup_enabled', '1');
    mockSettings.set('__last_auto_backup', String(Date.now()));

    await performBackup();

    expect(getBackupFailures().device).toBeDefined();
  });
});
