/**
 * Scenario: the share-sheet export waits on a copy that has not finished. Every
 * caller of `runDatabaseBackup` used the same five-minute budget, and the
 * export's expiry became a generic error alert while Rust went on copying.
 *
 * Expected behaviour: the foreground export gives up waiting after a minute and
 * says the copy is still running, the file is shared when the athlete comes
 * back to the screen, and the two callers nobody is watching keep the long
 * budget and the throw.
 */

import { exportDatabaseBackup, resumePendingDatabaseExport } from '@/features/settings/lib/backup';
import {
  runDatabaseBackup,
  BACKUP_TIMEOUT_MS,
  FOREGROUND_BACKUP_TIMEOUT_MS,
} from '@/features/settings/lib/runBackup';

/** The copy Rust is running, settled by the test when it means it to land. */
let copy: { promise: Promise<void>; settle: () => void; fail: (e: Error) => void };
const runBackup = jest.fn((_destPath: string) => copy.promise);

const mockEngine = {
  runBackup,
  getSetting: () => undefined,
  setSetting: () => undefined,
};

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

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

beforeEach(() => {
  runBackup.mockReset();
  let settle: () => void = () => {};
  let fail: (e: Error) => void = () => {};
  const promise = new Promise<void>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  copy = { promise, settle, fail };
  runBackup.mockImplementation(() => copy.promise);
  mockShareAsync.mockClear();
});

it('caps the foreground wait at a minute and leaves the long budget alone', () => {
  expect(FOREGROUND_BACKUP_TIMEOUT_MS).toBe(60_000);
  expect(BACKUP_TIMEOUT_MS).toBe(5 * 60 * 1000);
});

it('reports a copy still running rather than throwing, when the caller asks for that', async () => {
  await expect(
    runDatabaseBackup(mockEngine, '/cache/out.veloqdb', { timeoutMs: 0, onLapse: 'report' })
  ).resolves.toBe('running');
});

it('still throws for a caller that did not ask, so a wipe never proceeds without its snapshot', async () => {
  await expect(
    runDatabaseBackup(mockEngine, '/cache/out.veloqdb', { timeoutMs: 0 })
  ).rejects.toThrow(/did not finish in time/);
});

it('shares nothing at the cap, then shares the same file when the screen comes back', async () => {
  await expect(exportDatabaseBackup({ timeoutMs: 0 })).resolves.toBe('still-running');
  expect(mockShareAsync).not.toHaveBeenCalled();
  const startedPath = runBackup.mock.calls[0][0];

  copy.settle();
  await Promise.resolve();
  await expect(resumePendingDatabaseExport()).resolves.toBe('shared');
  expect(mockShareAsync).toHaveBeenCalledTimes(1);
  expect(mockShareAsync.mock.calls[0][0]).toBe(`file://${startedPath}`);

  // Once shared, nothing is owed and the copy is not started again.
  await expect(resumePendingDatabaseExport()).resolves.toBe('nothing-pending');
  expect(runBackup).toHaveBeenCalledTimes(1);
});

it('keeps the file owed while the copy is still going', async () => {
  await exportDatabaseBackup({ timeoutMs: 0 });

  await expect(resumePendingDatabaseExport()).resolves.toBe('still-running');
  expect(mockShareAsync).not.toHaveBeenCalled();
});
