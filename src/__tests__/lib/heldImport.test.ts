/**
 * Scenario: an athlete on the login screen, with the engine closed, picks an
 * older backup. The engine places no record before someone signs in.
 *
 * Expected behaviour: the file is read and converted when it is picked, so an
 * unreadable one is refused before anything is kept, and the readable one is
 * kept in the documents directory without reaching the engine. The first
 * signed-in launch restores it through the record path, says what came back,
 * deletes it whether the restore placed it or refused it, and answers the
 * one-time restore offer. A closed engine at launch keeps it for the next.
 */

import { Alert } from 'react-native';

import { applyHeldImport, holdImportWhileSignedOut } from '@/features/settings/lib/heldImport';

const mockFiles = new Map<string, string>();
const mockEngineState = { ready: false };
const mockConvert = jest.fn(async (_source: string, dest: string) => {
  mockFiles.set(`file://${dest}`, 'record-zip');
});
const mockRestoreBackup = jest.fn(async (_json: string) => ({ unplacedCount: 2 }));
const mockRestoreRecordBackup = jest.fn(async (_uri: string) => ({
  placed: 3,
  unplaced: 1,
  missingActivityIds: [],
}));
const mockMarkAnswered = jest.fn();

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({}),
  isEngineReady: () => mockEngineState.ready,
  getNativeModule: () => ({ convertLegacyDatabaseToRecordBackup: mockConvert }),
}));

jest.mock('@/features/settings/lib/backup', () => ({
  convertLegacyBackupToRecord: jest.requireActual('@/features/settings/lib/backup')
    .convertLegacyBackupToRecord,
  convertLegacyDatabaseFile: jest.requireActual('@/features/settings/lib/backup')
    .convertLegacyDatabaseFile,
  importWaitsForSignIn: jest.requireActual('@/features/settings/lib/backup').importWaitsForSignIn,
  restoreBackup: (json: string) => mockRestoreBackup(json),
  restoreRecordBackup: (uri: string) => mockRestoreRecordBackup(uri),
}));

jest.mock('@/features/settings/lib/autobackup/autoBackup', () => ({
  markPlatformRecordAnswered: () => mockMarkAnswered(),
}));

jest.mock('@/shared/storage/cacheFiles', () => ({
  restoreCopyUri: async (name: string) => `file:///cache/restores/${name}`,
}));

jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  documentDirectory: 'file:///docs/',
  getInfoAsync: jest.fn(async (uri: string) =>
    mockFiles.has(uri) ? { exists: true, size: mockFiles.get(uri)!.length } : { exists: false }
  ),
  readAsStringAsync: jest.fn(async (uri: string) => {
    const text = mockFiles.get(uri);
    if (text === undefined) throw new Error(`no file ${uri}`);
    return text;
  }),
  writeAsStringAsync: jest.fn(async (uri: string, text: string) => {
    mockFiles.set(uri, text);
  }),
  copyAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
    const text = mockFiles.get(from);
    if (text === undefined) throw new Error(`no file ${from}`);
    mockFiles.set(to, text);
  }),
  moveAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
    const text = mockFiles.get(from);
    if (text === undefined) throw new Error(`no file ${from}`);
    mockFiles.delete(from);
    mockFiles.set(to, text);
  }),
  deleteAsync: jest.fn(async (uri: string) => {
    mockFiles.delete(uri);
  }),
}));

const t = ((key: string, options?: { count?: number }) =>
  options?.count === undefined ? key : `${key}:${options.count}`) as never;

const LEGACY_JSON = JSON.stringify({ version: 2, routeNames: { 'route-1': 'Harbour loop' } });
const PICKED_VELOQ = 'file:///cache/DocumentPicker/old.veloq';
const PICKED_DB = 'file:///cache/DocumentPicker/older.veloqdb';

function heldFiles(): string[] {
  return [...mockFiles.keys()].filter((uri) => uri.startsWith('file:///docs/'));
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  mockFiles.clear();
  mockEngineState.ready = false;
  mockFiles.set(PICKED_VELOQ, LEGACY_JSON);
  mockFiles.set(PICKED_DB, 'sqlite');
});

describe('a legacy backup picked while signed out', () => {
  it('keeps a readable .veloq file and writes nothing to the engine', async () => {
    expect(await holdImportWhileSignedOut(PICKED_VELOQ, 'old.veloq')).toBe(true);

    expect(heldFiles()).toHaveLength(1);
    expect(mockFiles.get(heldFiles()[0])).toBe(LEGACY_JSON);
    expect(mockRestoreBackup).not.toHaveBeenCalled();
    expect(mockRestoreRecordBackup).not.toHaveBeenCalled();
  });

  it('refuses an unreadable .veloq file before keeping anything', async () => {
    mockFiles.set(PICKED_VELOQ, JSON.stringify({ version: 9 }));
    await expect(holdImportWhileSignedOut(PICKED_VELOQ, 'old.veloq')).rejects.toThrow(
      'Unsupported backup version'
    );
    mockFiles.set(PICKED_VELOQ, '{not json');
    await expect(holdImportWhileSignedOut(PICKED_VELOQ, 'old.veloq')).rejects.toThrow(
      'Invalid backup file format'
    );
    expect(heldFiles()).toEqual([]);
  });

  it('converts a .veloqdb file to a record zip and keeps only that', async () => {
    expect(await holdImportWhileSignedOut(PICKED_DB, 'older.veloqdb')).toBe(true);

    expect(mockConvert).toHaveBeenCalledTimes(1);
    expect(heldFiles()).toHaveLength(1);
    expect(mockFiles.get(heldFiles()[0])).toBe('record-zip');
    expect(
      [...mockFiles.keys()].filter((uri) => uri.startsWith('file:///cache/restores/'))
    ).toEqual([]);
  });

  it('keeps nothing when the conversion refuses the file', async () => {
    mockConvert.mockRejectedValueOnce(new Error('Not a Veloq backup'));
    await expect(holdImportWhileSignedOut(PICKED_DB, 'older.veloqdb')).rejects.toThrow(
      'Not a Veloq backup'
    );
    expect(heldFiles()).toEqual([]);
  });

  it('keeps only the latest pick', async () => {
    await holdImportWhileSignedOut(PICKED_DB, 'older.veloqdb');
    await holdImportWhileSignedOut(PICKED_VELOQ, 'old.veloq');

    expect(heldFiles()).toHaveLength(1);
    expect(mockFiles.get(heldFiles()[0])).toBe(LEGACY_JSON);
  });

  it('holds nothing while the engine is open, or for a record zip', async () => {
    mockEngineState.ready = true;
    expect(await holdImportWhileSignedOut(PICKED_VELOQ, 'old.veloq')).toBe(false);
    mockEngineState.ready = false;
    expect(await holdImportWhileSignedOut('file:///cache/x.zip', 'veloq-backup.zip')).toBe(false);
    expect(heldFiles()).toEqual([]);
  });
});

describe('the first signed-in launch', () => {
  it('restores a held .veloq file through the record path and deletes it', async () => {
    await holdImportWhileSignedOut(PICKED_VELOQ, 'old.veloq');
    mockEngineState.ready = true;
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());

    expect(await applyHeldImport(t)).toBe(true);

    expect(mockRestoreBackup).toHaveBeenCalledWith(LEGACY_JSON);
    expect(alert).toHaveBeenCalledWith('backup.restoreComplete', 'backup.recordRestored');
    expect(mockMarkAnswered).toHaveBeenCalledTimes(1);
    expect(heldFiles()).toEqual([]);
    expect(await applyHeldImport(t)).toBe(false);
    expect(mockRestoreBackup).toHaveBeenCalledTimes(1);
  });

  it('restores a held record zip through the record path and deletes it', async () => {
    await holdImportWhileSignedOut(PICKED_DB, 'older.veloqdb');
    const [held] = heldFiles();
    mockEngineState.ready = true;
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());

    expect(await applyHeldImport(t)).toBe(true);

    expect(mockRestoreRecordBackup).toHaveBeenCalledWith(held);
    expect(alert).toHaveBeenCalledWith('backup.restoreComplete', 'backup.recordRestored');
    expect(heldFiles()).toEqual([]);
  });

  it("names another athlete's record and does not offer it again", async () => {
    await holdImportWhileSignedOut(PICKED_DB, 'older.veloqdb');
    mockEngineState.ready = true;
    mockRestoreRecordBackup.mockRejectedValueOnce(new Error('Record belongs to another athlete'));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());

    expect(await applyHeldImport(t)).toBe(true);

    expect(alert).toHaveBeenCalledWith('common.error', 'backup.backupDifferentAccount');
    expect(mockMarkAnswered).toHaveBeenCalledTimes(1);
    expect(heldFiles()).toEqual([]);
  });

  it('reports any other failure as an import error, never as restored', async () => {
    await holdImportWhileSignedOut(PICKED_VELOQ, 'old.veloq');
    mockEngineState.ready = true;
    mockRestoreBackup.mockRejectedValueOnce(new Error('database or disk is full'));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());

    expect(await applyHeldImport(t)).toBe(true);

    expect(alert).toHaveBeenCalledWith('common.error', 'backup.importError');
    expect(alert).not.toHaveBeenCalledWith('backup.restoreComplete', expect.anything());
  });

  it('keeps the held file while the engine is still closed', async () => {
    await holdImportWhileSignedOut(PICKED_VELOQ, 'old.veloq');

    expect(await applyHeldImport(t)).toBe(false);

    expect(mockRestoreBackup).not.toHaveBeenCalled();
    expect(mockMarkAnswered).not.toHaveBeenCalled();
    expect(heldFiles()).toHaveLength(1);
  });

  it('answers nothing when no import is held', async () => {
    mockEngineState.ready = true;
    expect(await applyHeldImport(t)).toBe(false);
    expect(mockMarkAnswered).not.toHaveBeenCalled();
  });

  it('restores once when two launches ask at the same moment', async () => {
    await holdImportWhileSignedOut(PICKED_VELOQ, 'old.veloq');
    mockEngineState.ready = true;
    jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());

    await Promise.all([applyHeldImport(t), applyHeldImport(t)]);

    expect(mockRestoreBackup).toHaveBeenCalledTimes(1);
    expect(Alert.alert).toHaveBeenCalledTimes(1);
  });
});
