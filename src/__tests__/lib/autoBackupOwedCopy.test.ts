/**
 * Scenario: Back Up Now runs with automatic backup off while a remote carrier
 * cannot take the zip, because the radio is down or the server did not answer.
 * Expected behaviour: the copy stays owed, the next reconnect, sync, foreground
 * or background sends it to that carrier alone, whatever the switch says, and
 * once it lands nothing more is retried.
 */

import * as Network from 'expo-network';
import {
  performBackup,
  onBackupReconnect,
  onSyncComplete,
  onAppForeground,
  onAppBackground,
  forgetBackupCarrier,
  type BackupBackend,
} from '@/features/settings/lib/autobackup';
import { BackupTransferError } from '@/features/settings/lib/autobackup/backends/errors';

const mockSettings = new Map<string, string>();
const mockRunRecordBackup = jest.fn(async (_path: string) => {});
const mockCarriers: BackupBackend[] = [];

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    getSetting: (key: string) => mockSettings.get(key),
    deleteSetting: (key: string) => mockSettings.delete(key),
    engineInstall: () => 1,
    setSetting: (key: string, value: string) => mockSettings.set(key, value),
    runRecordBackup: (path: string) => mockRunRecordBackup(path),
  }),
}));

jest.mock('@/features/settings/lib/autobackup/backends/carriers', () => ({
  get backupCarriers() {
    return mockCarriers;
  },
}));

jest.mock('@/features/settings/lib/autobackup/backends/folderBackend', () => ({
  ...jest.requireActual('@/features/settings/lib/autobackup/backends/folderBackend'),
  forgetBackupFolder: () => {},
}));

jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  documentDirectory: 'file:///docs/',
  cacheDirectory: 'file:///cache/',
  makeDirectoryAsync: jest.fn().mockResolvedValue(undefined),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
  getInfoAsync: jest.fn().mockResolvedValue({ exists: true, size: 4096 }),
}));

jest.mock('expo-network', () => ({
  ...jest.requireActual('expo-network'),
  getNetworkStateAsync: jest.fn(),
}));

const networkState = Network.getNetworkStateAsync as jest.Mock;

function radio(up: boolean) {
  networkState.mockResolvedValue({ isConnected: up, isInternetReachable: up });
}

function carrier(id: string, isRemote: boolean, upload: BackupBackend['upload']): BackupBackend {
  return {
    id,
    name: id,
    isRemote,
    isAvailable: async () => true,
    listBackups: async () => [],
    upload,
    download: async () => {},
    delete: async () => {},
  };
}

const remoteUpload = jest.fn(async (_path: string, _entry: unknown) => 'veloq-backup.zip');
const folderUpload = jest.fn(async (_path: string, _entry: unknown) => 'veloq-backup.zip');

// The stub carriers keep nothing, so every copy they hand back reads as the zip sent.
jest.mock('@/features/settings/lib/autobackup/zipFingerprint', () => ({
  ...jest.requireActual('@/features/settings/lib/autobackup/zipFingerprint'),
  zipFingerprint: async () => ({ sha256: '00', size: 4096 }),
}));

/** Let a fire-and-forget trigger run its backup to the end. */
async function settle() {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSettings.clear();
  mockSettings.set('__auto_backup_enabled', '0');
  radio(true);
  remoteUpload.mockImplementation(async () => 'veloq-backup.zip');
  folderUpload.mockImplementation(async () => 'veloq-backup.zip');
  mockCarriers.length = 0;
  mockCarriers.push(carrier('webdav', true, remoteUpload), carrier('folder', false, folderUpload));
});

async function backUpNowOffline() {
  radio(false);
  const result = await performBackup(true);
  expect(result.carriers.webdav).toEqual({ status: 'skipped', reason: 'no-radio' });
  expect(remoteUpload).not.toHaveBeenCalled();
  expect(folderUpload).toHaveBeenCalledTimes(1);
  radio(true);
}

describe('a remote copy Back Up Now could not send', () => {
  it.each([
    ['reconnect', onBackupReconnect],
    ['sync', onSyncComplete],
    ['foreground', onAppForeground],
    ['background', onAppBackground],
  ])('is sent on the next %s with the switch off, to that carrier alone', async (_, trigger) => {
    await backUpNowOffline();

    trigger();
    await settle();

    expect(remoteUpload).toHaveBeenCalledTimes(1);
    expect(remoteUpload.mock.calls[0][0]).toBe('file:///docs/veloq-decisions.zip');
    expect(folderUpload).toHaveBeenCalledTimes(1);
  });

  it('is sent once, and a later trigger retries nothing', async () => {
    await backUpNowOffline();

    onBackupReconnect();
    await settle();
    onBackupReconnect();
    onAppForeground();
    onSyncComplete();
    await settle();

    expect(remoteUpload).toHaveBeenCalledTimes(1);
    expect(mockRunRecordBackup).toHaveBeenCalledTimes(2);
  });

  it('waits while the radio is still down, writing no archive', async () => {
    await backUpNowOffline();
    radio(false);

    onAppForeground();
    onAppBackground();
    await settle();

    expect(remoteUpload).not.toHaveBeenCalled();
    expect(mockRunRecordBackup).toHaveBeenCalledTimes(1);

    radio(true);
    onBackupReconnect();
    await settle();
    expect(remoteUpload).toHaveBeenCalledTimes(1);
  });

  it('is retried after a transient failure, and dropped after a permanent one', async () => {
    remoteUpload.mockRejectedValueOnce(
      new BackupTransferError('upload', 'transport', 'unreachable')
    );
    await performBackup(true);
    expect(remoteUpload).toHaveBeenCalledTimes(1);

    remoteUpload.mockRejectedValueOnce(new BackupTransferError('upload', 'auth', 'rejected', 401));
    onAppForeground();
    await settle();
    expect(remoteUpload).toHaveBeenCalledTimes(2);

    onAppForeground();
    onBackupReconnect();
    await settle();
    expect(remoteUpload).toHaveBeenCalledTimes(2);
  });

  it('stays owed while the retry still cannot reach the server', async () => {
    remoteUpload.mockRejectedValue(new BackupTransferError('upload', 'transport', 'unreachable'));
    await performBackup(true);
    onBackupReconnect();
    await settle();
    expect(remoteUpload).toHaveBeenCalledTimes(2);

    remoteUpload.mockImplementation(async () => 'veloq-backup.zip');
    onAppForeground();
    await settle();
    expect(remoteUpload).toHaveBeenCalledTimes(3);
    expect(folderUpload).toHaveBeenCalledTimes(1);
  });

  it('is forgotten with the carriers, so the next athlete inherits no retry', async () => {
    await backUpNowOffline();

    forgetBackupCarrier();
    onBackupReconnect();
    onAppForeground();
    await settle();

    expect(remoteUpload).not.toHaveBeenCalled();
  });

  it('is dropped when the carrier is removed before the retry', async () => {
    await backUpNowOffline();
    mockCarriers[0] = { ...mockCarriers[0], isAvailable: async () => false };

    onBackupReconnect();
    await settle();
    mockCarriers[0] = carrier('webdav', true, remoteUpload);
    onBackupReconnect();
    await settle();

    expect(remoteUpload).not.toHaveBeenCalled();
  });

  it('owes nothing when every carrier took the zip', async () => {
    await performBackup(true);

    onBackupReconnect();
    onAppForeground();
    await settle();

    expect(remoteUpload).toHaveBeenCalledTimes(1);
    expect(mockRunRecordBackup).toHaveBeenCalledTimes(1);
  });
});

describe('Back Up Now during a run that pays only an owed copy', () => {
  /** Hold the next remote upload until the returned release is called. */
  function holdRemoteUpload(): () => void {
    let release: () => void = () => {};
    remoteUpload.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          release = () => resolve('veloq-backup.zip');
        })
    );
    return () => release();
  }

  async function until(condition: () => boolean, what: string) {
    for (let i = 0; i < 300 && !condition(); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (!condition()) throw new Error(`${what} never happened`);
  }

  it('reaches every carrier and reports each one, not the narrower run', async () => {
    await backUpNowOffline();
    const release = holdRemoteUpload();

    onBackupReconnect();
    await until(() => remoteUpload.mock.calls.length === 1, 'the owed upload');
    const forced = performBackup(true);
    release();
    const result = await forced;

    expect(remoteUpload).toHaveBeenCalledTimes(2);
    expect(folderUpload).toHaveBeenCalledTimes(2);
    expect(result.wroteZip).toBe(true);
    expect(result.carriers).toEqual({
      webdav: { status: 'written' },
      folder: { status: 'written' },
    });
  });

  it('never asks for a second archive while the first is still being written', async () => {
    await backUpNowOffline();
    const release = holdRemoteUpload();

    onBackupReconnect();
    await until(() => remoteUpload.mock.calls.length === 1, 'the owed upload');
    const forced = performBackup(true);
    await settle();

    expect(mockRunRecordBackup).toHaveBeenCalledTimes(2);
    release();
    await forced;
    expect(mockRunRecordBackup).toHaveBeenCalledTimes(3);
  });

  it('shares one forced run between two taps', async () => {
    await backUpNowOffline();
    const release = holdRemoteUpload();

    onBackupReconnect();
    await until(() => remoteUpload.mock.calls.length === 1, 'the owed upload');
    const first = performBackup(true);
    const second = performBackup(true);
    release();
    const [a, b] = await Promise.all([first, second]);

    expect(b).toBe(a);
    expect(mockRunRecordBackup).toHaveBeenCalledTimes(3);
    expect(folderUpload).toHaveBeenCalledTimes(2);
  });

  it('runs its own backup when the run it met turns out not to be due', async () => {
    await backUpNowOffline();
    let answerRadio: (up: boolean) => void = () => {};
    networkState.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answerRadio = (up) => resolve({ isConnected: up, isInternetReachable: up });
        })
    );
    radio(false);
    const checksBefore = networkState.mock.calls.length;

    onAppForeground();
    await until(() => networkState.mock.calls.length > checksBefore, 'the radio check');
    const forced = performBackup(true);
    answerRadio(false);
    const result = await forced;

    expect(result.wroteZip).toBe(true);
    expect(folderUpload).toHaveBeenCalledTimes(2);
    expect(result.carriers.folder).toEqual({ status: 'written' });
    expect(result.carriers.webdav).toEqual({ status: 'skipped', reason: 'no-radio' });
  });

  it('is joined by a later automatic trigger rather than run beside', async () => {
    await backUpNowOffline();
    const release = holdRemoteUpload();

    onBackupReconnect();
    await until(() => remoteUpload.mock.calls.length === 1, 'the owed upload');
    const forced = performBackup(true);
    const automatic = performBackup();
    release();

    await expect(automatic).resolves.toBe(await forced);
    expect(mockRunRecordBackup).toHaveBeenCalledTimes(3);
  });
});
