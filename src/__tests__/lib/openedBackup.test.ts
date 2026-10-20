/**
 * Scenario: a backup reaches the app from outside it. iOS opens a mailed zip as a copy in the
 * app's Inbox, a file manager on Android hands over a content URI that names no file, another
 * app shares a file, or the file arrives while the launch has not yet opened the engine.
 *
 * Expected behaviour: each goes through the import path with a name that says its kind, from its
 * own name or else its first bytes, and the copies the app made are deleted. A signed-in
 * athlete's file waits for the engine and restores once it opens. Links that are not files pass
 * through untouched.
 */

import * as FileSystem from 'expo-file-system/legacy';
import { clearSharedPayloads, getResolvedSharedPayloadsAsync } from 'expo-sharing';

import { markPlatformRecordAnswered } from '@/features/settings/lib/autobackup/autoBackup';
import { importWaitsForSignIn } from '@/features/settings/lib/backup';
import { importBackupFile } from '@/features/settings/lib/importBackupFile';
import {
  applyOpenedBackup,
  fileNameOf,
  openedFrom,
  receiveOpenedBackup,
} from '@/features/settings/lib/openedBackup';
import { getStoredCredentials } from '@/shared/app/AuthStore';

const t = ((key: string) => key) as never;
let mockHead = '';

jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  cacheDirectory: 'file:///cache/',
  documentDirectory: 'file:///docs/',
  EncodingType: { UTF8: 'utf8', Base64: 'base64' },
  makeDirectoryAsync: jest.fn(async () => undefined),
  copyAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
  readAsStringAsync: jest.fn(async () => mockHead),
}));
jest.mock('expo-sharing', () => ({
  ...jest.requireActual('expo-sharing'),
  getResolvedSharedPayloadsAsync: jest.fn(async () => []),
  clearSharedPayloads: jest.fn(),
}));
jest.mock('@/features/settings/lib/importBackupFile', () => ({
  importBackupFile: jest.fn(async () => ({ success: true, activityCount: 0 })),
}));
jest.mock('@/features/settings/lib/backup', () => ({ importWaitsForSignIn: jest.fn(() => false) }));
jest.mock('@/features/settings/lib/autobackup/autoBackup', () => ({
  markPlatformRecordAnswered: jest.fn(),
}));
jest.mock('@/shared/app/AuthStore', () => ({
  getStoredCredentials: jest.fn(() => ({ athleteId: 'i1001' })),
}));

const imported = jest.mocked(importBackupFile);

/** The name and the copy the import path was handed. */
function importedAs(): { uri: string; name: string } {
  expect(imported).toHaveBeenCalledTimes(1);
  const [uri, name] = imported.mock.calls[0]!;
  return { uri, name };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockHead = '';
  jest.mocked(importWaitsForSignIn).mockReturnValue(false);
  jest.mocked(getStoredCredentials).mockReturnValue({ athleteId: 'i1001' } as never);
  jest.mocked(getResolvedSharedPayloadsAsync).mockResolvedValue([]);
  imported.mockResolvedValue({
    success: true,
    unplacedCount: 0,
    drops: { notRestored: 0, namesNotRestored: 0, exportHomeLeftOut: false },
  });
});

describe('which links are files', () => {
  it.each([
    'file:///var/mobile/Containers/Data/Application/A1/Documents/Inbox/backup.zip',
    'content://com.android.externalstorage.documents/document/primary%3ADownload%2Fx.veloq',
    'veloq://expo-sharing',
  ])('takes %s', (url) => {
    expect(openedFrom(url)).not.toBeNull();
  });

  it.each(['veloq://activity/a42', 'https://intervals.icu', 'veloq://expo-sharing/extra', ''])(
    'passes %s through',
    (url) => {
      expect(openedFrom(url)).toBeNull();
      expect(receiveOpenedBackup(url)).toBe(false);
    }
  );

  it('reads the file name out of a document provider id', () => {
    expect(
      fileNameOf(
        'content://com.android.externalstorage.documents/document/primary%3ADownload%2Fold.veloqdb'
      )
    ).toBe('old.veloqdb');
    expect(fileNameOf('file:///docs/Inbox/veloq%20backup.zip')).toBe('veloq backup.zip');
    expect(fileNameOf('content://mail.provider/attachments/0.1/BEST/false')).toBe('false');
  });
});

describe('restoring an opened file', () => {
  it('imports an iOS Inbox copy by its name and deletes both copies', async () => {
    const inbox = 'file:///docs/Inbox/veloq-2026-10-01.zip';
    expect(receiveOpenedBackup(inbox)).toBe(true);

    await expect(applyOpenedBackup(t)).resolves.toBe(true);

    const { uri, name } = importedAs();
    expect(name).toBe('veloq-2026-10-01.zip');
    expect(uri).toMatch(/^file:\/\/\/cache\/restores\//);
    expect(FileSystem.copyAsync).toHaveBeenCalledWith({ from: inbox, to: uri });
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(uri, { idempotent: true });
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(inbox, { idempotent: true });
    expect(markPlatformRecordAnswered).toHaveBeenCalled();
  });

  it.each([
    ['UEsDBBQAAAAIAA', 'false.zip'],
    ['U1FMaXRlIGZvcm1hdCAzAA', 'false.veloqdb'],
    ['eyJ2ZXJzaW9uIjox', 'false.veloq'],
  ])('names a file that does not name itself by its first bytes %s', async (head, expected) => {
    mockHead = head;
    receiveOpenedBackup('content://mail.provider/attachments/0.1/BEST/false');

    await applyOpenedBackup(t);

    expect(importedAs().name).toBe(expected);
    // A provider's file is the provider's, never deleted.
    expect(FileSystem.deleteAsync).toHaveBeenCalledTimes(1);
  });

  it('hands a file of no known kind over under its own name, for the import to refuse', async () => {
    mockHead = 'iVBORw0KGgo';
    imported.mockResolvedValueOnce({ success: false, refusal: 'missing' });
    receiveOpenedBackup('content://mail.provider/attachments/0.1/BEST/false');

    await applyOpenedBackup(t);

    expect(importedAs().name).toBe('false');
    expect(markPlatformRecordAnswered).not.toHaveBeenCalled();
  });

  it('imports a shared file and clears the share', async () => {
    jest.mocked(getResolvedSharedPayloadsAsync).mockResolvedValue([
      {
        value: 'content://a/b',
        shareType: 'file',
        contentUri: 'content://downloads/public/77',
        contentType: 'file',
        contentMimeType: 'application/zip',
        originalName: 'ride-backup.zip',
        contentSize: 1024,
      },
    ]);
    receiveOpenedBackup('veloq://expo-sharing');

    await applyOpenedBackup(t);

    expect(importedAs().name).toBe('ride-backup.zip');
    expect(FileSystem.copyAsync).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'content://downloads/public/77' })
    );
    expect(clearSharedPayloads).toHaveBeenCalled();
  });

  it('takes nothing from a share that carries no file', async () => {
    receiveOpenedBackup('veloq://expo-sharing');

    await expect(applyOpenedBackup(t)).resolves.toBe(true);

    expect(imported).not.toHaveBeenCalled();
    expect(clearSharedPayloads).toHaveBeenCalled();
  });

  it('keeps a signed-in file until the engine opens, then restores it once', async () => {
    jest.mocked(importWaitsForSignIn).mockReturnValue(true);
    receiveOpenedBackup('file:///docs/Inbox/early.zip');

    await expect(applyOpenedBackup(t)).resolves.toBe(false);
    expect(imported).not.toHaveBeenCalled();

    jest.mocked(importWaitsForSignIn).mockReturnValue(false);
    await expect(applyOpenedBackup(t)).resolves.toBe(true);
    expect(importedAs().name).toBe('early.zip');

    await expect(applyOpenedBackup(t)).resolves.toBe(false);
    expect(imported).toHaveBeenCalledTimes(1);
  });

  it('hands a signed-out file to the import path, which holds it for sign-in', async () => {
    jest.mocked(importWaitsForSignIn).mockReturnValue(true);
    jest.mocked(getStoredCredentials).mockReturnValue({ athleteId: null } as never);
    receiveOpenedBackup('file:///docs/Inbox/before-sign-in.veloq');

    await expect(applyOpenedBackup(t)).resolves.toBe(true);

    expect(importedAs().name).toBe('before-sign-in.veloq');
  });

  it('deletes its copy when the import throws', async () => {
    imported.mockRejectedValueOnce(new Error('disk full'));
    jest.spyOn(require('react-native').Alert, 'alert').mockImplementation(() => {});
    receiveOpenedBackup('file:///docs/Inbox/broken.zip');

    await expect(applyOpenedBackup(t)).resolves.toBe(true);

    const { uri } = importedAs();
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(uri, { idempotent: true });
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith('file:///docs/Inbox/broken.zip', {
      idempotent: true,
    });
  });
});
