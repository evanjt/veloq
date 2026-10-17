/**
 * Scenario: the athlete restores a backup, picked from the phone or listed by
 * a destination, and the restore replaces their settings and names.
 *
 * Expected behaviour: the file is obtained and checked by the engine before
 * anything is asked. A file the check refuses is refused without a question
 * and nothing is restored. A file it accepts is asked about by what it holds,
 * on a button that says what it replaces, and restored only on that answer.
 */

import type { TFunction } from 'i18next';

import { checkBackupFile } from '@/features/settings/lib/checkedRestore';
import { importBackupFile } from '@/features/settings/lib/importBackupFile';
import { restoreBackendEntry } from '@/features/settings/lib/restoreBackendEntry';
import {
  convertLegacyDatabaseFile,
  restoreRecordBackup,
  type RestoreCheck,
} from '@/features/settings/lib/backup';
import type { BackupBackend, BackupEntry } from '@/features/settings/lib/autobackup';
import { confirmAction, inform } from '@/shared/ui/dialog';

const CHECKED: RestoreCheck = {
  writtenAt: '2026-10-01T12:00:00.000Z',
  namesAccount: true,
  names: 3,
  settings: 2,
  decisions: 4,
};

const mockChecks = {
  checkRecordBackup: jest.fn(async (_uri: string) => CHECKED),
  checkLegacyBackup: jest.fn(async (_json: string) => CHECKED),
};
const mockAnswer = { confirm: true };

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('@/features/settings/lib/backup', () => {
  class SignInRequiredError extends Error {}
  return {
    SignInRequiredError,
    importWaitsForSignIn: () => false,
    checkRecordBackup: (uri: string) => mockChecks.checkRecordBackup(uri),
    checkLegacyBackup: (json: string) => mockChecks.checkLegacyBackup(json),
    convertLegacyDatabaseFile: jest.fn(async () => {}),
    restoreBackup: jest.fn(async () => ({
      unplacedCount: 0,
      drops: { notRestored: 0, namesNotRestored: 0 },
    })),
    restoreRecordBackup: jest.fn(async () => ({
      placed: 5,
      unplaced: 0,
      missingActivityIds: [],
      notRestored: 0,
      namesNotRestored: 0,
    })),
  };
});
jest.mock('@/features/settings/lib/heldImport', () => ({
  holdImportWhileSignedOut: jest.fn(async () => false),
  isHeldWhileSignedOut: () => true,
  discardHeldImport: jest.fn(async () => {}),
}));
jest.mock('@/features/settings/lib/restoreNotice', () => ({
  showRestoreNotice: jest.fn(),
}));
jest.mock('@/shared/storage/cacheFiles', () => ({
  restoreCopyUri: async (name: string) => `file:///cache/restores/${name}`,
}));
jest.mock('@/shared/ui/dialog', () => ({
  inform: jest.fn(),
  confirmAction: jest.fn(
    (args: { onConfirm: () => void; onCancel?: () => void }) =>
      void (mockAnswer.confirm ? args.onConfirm() : args.onCancel?.())
  ),
}));
jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  getInfoAsync: jest.fn(async () => ({ exists: true, size: 2048 })),
  readAsStringAsync: jest.fn(async () => '{"version": 2}'),
  deleteAsync: jest.fn(async () => {}),
}));

const t = ((key: string, options?: Record<string, unknown>) =>
  options ? `${key} ${JSON.stringify(options)}` : key) as unknown as TFunction;

const refusedZip = () => {
  throw new Error('invalid Zip archive: Could not find EOCD');
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAnswer.confirm = true;
  mockChecks.checkRecordBackup.mockImplementation(async () => CHECKED);
  mockChecks.checkLegacyBackup.mockImplementation(async () => CHECKED);
});

function confirmed(): { message: string; confirmLabel: string; destructive: boolean } {
  const [asked] = jest.mocked(confirmAction).mock.calls[0];
  return {
    message: asked.message ?? '',
    confirmLabel: asked.confirmLabel,
    destructive: asked.destructive ?? false,
  };
}

describe('a picked file', () => {
  it('a file that is not a backup is refused before any question, and nothing is restored', async () => {
    mockChecks.checkRecordBackup.mockImplementation(refusedZip);

    const result = await importBackupFile('file:///cache/picked/holiday.zip', 'holiday.zip', t);

    expect(result).toBeNull();
    expect(mockChecks.checkRecordBackup).toHaveBeenCalledWith('file:///cache/picked/holiday.zip');
    expect(confirmAction).not.toHaveBeenCalled();
    expect(restoreRecordBackup).not.toHaveBeenCalled();
    expect(inform).toHaveBeenCalledTimes(1);
  });

  it('an older .veloq file the check refuses is refused before any question', async () => {
    mockChecks.checkLegacyBackup.mockImplementation(async () => {
      throw new Error('Unreadable section_numbers row');
    });

    const result = await importBackupFile('file:///cache/picked/old.veloq', 'old.veloq', t);

    expect(result).toBeNull();
    expect(confirmAction).not.toHaveBeenCalled();
  });

  it('a checked zip is asked about by what it holds, then restored', async () => {
    const result = await importBackupFile('file:///cache/picked/veloq.zip', 'veloq.zip', t);

    expect(mockChecks.checkRecordBackup.mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(confirmAction).mock.invocationCallOrder[0]
    );
    const asked = confirmed();
    expect(asked.confirmLabel).toBe('backup.replaceSettings');
    expect(asked.destructive).toBe(true);
    expect(asked.message).toContain('"value":3');
    expect(asked.message).toContain('"value":2');
    expect(asked.message).toContain('"value":4');
    expect(asked.message).toContain('backup.checkedAccount');
    expect(asked.message).toContain('backup.checkedWritten');
    expect(restoreRecordBackup).toHaveBeenCalledWith('file:///cache/picked/veloq.zip');
    expect(result).toMatchObject({ success: true });
  });

  it('a record that names no time or account says so', async () => {
    mockChecks.checkRecordBackup.mockImplementation(async () => ({
      ...CHECKED,
      writtenAt: null,
      namesAccount: false,
    }));

    await importBackupFile('file:///cache/picked/veloq.zip', 'veloq.zip', t);

    expect(confirmed().message).toContain('backup.checkedUndated');
    expect(confirmed().message).toContain('backup.checkedNoAccount');
  });

  it('declined, restores nothing', async () => {
    mockAnswer.confirm = false;

    const result = await importBackupFile('file:///cache/picked/veloq.zip', 'veloq.zip', t);

    expect(confirmAction).toHaveBeenCalledTimes(1);
    expect(restoreRecordBackup).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('an older database file is converted and its record checked before the question', async () => {
    await importBackupFile('file:///cache/picked/old.veloqdb', 'old.veloqdb', t);

    const [, recordUri] = jest.mocked(convertLegacyDatabaseFile).mock.calls[0];
    expect(mockChecks.checkRecordBackup).toHaveBeenCalledWith(recordUri);
    expect(mockChecks.checkRecordBackup.mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(confirmAction).mock.invocationCallOrder[0]
    );
    expect(restoreRecordBackup).toHaveBeenCalledWith(recordUri);
  });

  it('an older database file the converter cannot read is refused before any question', async () => {
    jest
      .mocked(convertLegacyDatabaseFile)
      .mockRejectedValueOnce(new Error('file is not a database'));

    const result = await importBackupFile('file:///cache/picked/photo.jpg', 'photo.jpg', t);

    expect(result).toBeNull();
    expect(confirmAction).not.toHaveBeenCalled();
    expect(restoreRecordBackup).not.toHaveBeenCalled();
  });

  it('an empty file is refused without reaching the engine', async () => {
    const FileSystem = jest.requireMock('expo-file-system/legacy');
    FileSystem.getInfoAsync.mockResolvedValueOnce({ exists: true, size: 0 });

    await expect(checkBackupFile('file:///cache/picked/veloq.zip', 'veloq.zip')).rejects.toThrow();
    expect(mockChecks.checkRecordBackup).not.toHaveBeenCalled();
  });
});

describe('a backup a destination lists', () => {
  const download = jest.fn(async (_id: string, _dest: string) => {});
  const backend = { id: 'webdav', download } as unknown as BackupBackend;
  const entry = { id: 'veloq-2026-10-01.zip', timestamp: CHECKED.writtenAt } as BackupEntry;

  it('is downloaded and checked before the question', async () => {
    const outcome = await restoreBackendEntry(backend, entry, t);

    expect(download.mock.invocationCallOrder[0]).toBeLessThan(
      mockChecks.checkRecordBackup.mock.invocationCallOrder[0]
    );
    expect(mockChecks.checkRecordBackup.mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(confirmAction).mock.invocationCallOrder[0]
    );
    expect(outcome).toMatchObject({ notRestored: 0, namesNotRestored: 0 });
  });

  it('one the check refuses is refused without a question', async () => {
    mockChecks.checkRecordBackup.mockImplementation(refusedZip);

    await expect(restoreBackendEntry(backend, entry, t)).rejects.toThrow();
    expect(confirmAction).not.toHaveBeenCalled();
    expect(restoreRecordBackup).not.toHaveBeenCalled();
  });

  it('declined, restores nothing', async () => {
    mockAnswer.confirm = false;

    expect(await restoreBackendEntry(backend, entry, t)).toBe('declined');
    expect(restoreRecordBackup).not.toHaveBeenCalled();
  });
});
