/**
 * Scenario: the athlete stops Export Backup, inside the foreground wait or
 * once the row says it is still running. Rust leaves the destination as it was
 * and rejects the run with `Cancelled`.
 *
 * Expected behaviour: the stop names the running backup's own id, nothing is
 * shared, no failure is alerted, and the row says the export was cancelled.
 */
import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { useExportRecordBackup } from '@/features/settings/hooks/useBackup';
import { FOREGROUND_BACKUP_TIMEOUT_MS } from '@/features/settings/lib/backup';
import { shareExistingFile } from '@/features/settings/lib/shareFile';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

const mockRunRecordBackup = jest.fn<Promise<void>, [string]>();
const mockCancelRun = jest.fn<boolean, [number]>();
let mockRun: number | undefined;

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    runRecordBackup: (path: string) => mockRunRecordBackup(path),
    getBackupScreenData: () => ({ recordBackupRun: mockRun }),
    cancelRun: (run: number) => mockCancelRun(run),
  }),
  getNativeModule: () => null,
  isEngineReady: () => true,
}));

jest.mock('@/features/settings/lib/shareFile', () => ({
  shareExistingFile: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  cacheDirectory: 'file:///cache/',
  documentDirectory: 'file:///docs/',
  makeDirectoryAsync: jest.fn().mockResolvedValue(undefined),
  getInfoAsync: jest.fn().mockResolvedValue({ exists: true, size: 4096 }),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
  readDirectoryAsync: jest.fn().mockResolvedValue([]),
}));

/** A write that rejects as cancelled once the engine is asked to stop it. */
function stoppableWrite() {
  let reject!: (err: unknown) => void;
  mockRunRecordBackup.mockImplementationOnce(
    () =>
      new Promise<void>((_resolve, rej) => {
        reject = rej;
      })
  );
  mockCancelRun.mockImplementation(() => {
    reject(Object.assign(new Error('Cancelled'), { tag: 'Cancelled' }));
    return true;
  });
}

async function flush() {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(10);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  mockRunRecordBackup.mockReset().mockResolvedValue(undefined);
  mockCancelRun.mockReset().mockReturnValue(false);
  mockRun = 11;
  (shareExistingFile as jest.Mock).mockClear();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('stops the export inside the wait and shares nothing', async () => {
  stoppableWrite();
  const { result } = await renderHook(() => useExportRecordBackup());

  let outcome!: Promise<unknown>;
  await act(async () => {
    outcome = result.current.exportRecordBackup();
    await jest.advanceTimersByTimeAsync(100);
  });
  await act(async () => {
    result.current.cancel();
  });

  await expect(outcome).resolves.toBe('cancelled');
  await flush();
  expect(mockCancelRun).toHaveBeenCalledWith(11);
  expect(shareExistingFile).not.toHaveBeenCalled();
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(result.current.cancelled).toBe(true);
});

it('stops an export whose wait lapsed and clears the still-running line', async () => {
  stoppableWrite();
  const { result } = await renderHook(() => useExportRecordBackup());

  await act(async () => {
    void result.current.exportRecordBackup();
  });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(FOREGROUND_BACKUP_TIMEOUT_MS + 2_000);
  });
  expect(result.current.stillRunning).toBe(true);

  await act(async () => {
    result.current.cancel();
  });
  await flush();

  expect(mockCancelRun).toHaveBeenCalledWith(11);
  expect(shareExistingFile).not.toHaveBeenCalled();
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(result.current.stillRunning).toBe(false);
  expect(result.current.cancelled).toBe(true);
});

it('asks nothing of the engine with no backup running', async () => {
  mockRun = undefined;
  const { result } = await renderHook(() => useExportRecordBackup());

  await act(async () => {
    result.current.cancel();
  });

  expect(mockCancelRun).not.toHaveBeenCalled();
  expect(result.current.cancelled).toBe(false);
});
