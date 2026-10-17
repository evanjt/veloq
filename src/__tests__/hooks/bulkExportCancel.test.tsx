/**
 * Scenario: the athlete stops a bulk export, inside the foreground wait or
 * after it has lapsed. Rust removes the partial file and rejects the run with
 * `Cancelled`.
 *
 * Expected behaviour: the stop names the running export's own id, nothing is
 * shared, no failure is alerted, and the row says the export was cancelled.
 */

import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { useBulkExport } from '@/features/settings/hooks/useBulkExport';
import { forgetPendingBulkExport } from '@/features/settings/lib/bulkExport';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysWithValues());

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

const mockRunBulkExport = jest.fn();
const mockCancelRun = jest.fn();
let mockProgress: { running: boolean; run?: number; visited: number; total: number } = {
  running: false,
  visited: 0,
  total: 0,
};
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    runBulkExport: (...args: unknown[]) => mockRunBulkExport(...args),
    bulkExportProgress: () => mockProgress,
    cancelRun: (run: number) => mockCancelRun(run),
  }),
}));

jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  cacheDirectory: 'file:///cache/',
  deleteAsync: jest.fn().mockResolvedValue(undefined),
}));

const mockShare = jest.fn();
jest.mock('@/features/settings/lib/shareFile', () => ({
  shareExistingFile: (...args: unknown[]) => mockShare(...args),
}));

const PAST_THE_WAIT_MS = 61_000;
const cancelled = Object.assign(new Error('Cancelled'), { tag: 'Cancelled' });

/** A write that rejects as cancelled once the engine is asked to stop it. */
function stoppableWrite() {
  let reject!: (err: unknown) => void;
  mockRunBulkExport.mockImplementationOnce(
    () =>
      new Promise((_resolve, rej) => {
        reject = rej;
      })
  );
  mockCancelRun.mockImplementation(() => {
    reject(cancelled);
    return true;
  });
}

let alert: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  mockRunBulkExport.mockReset();
  mockCancelRun.mockReset().mockReturnValue(false);
  mockShare.mockReset().mockResolvedValue(undefined);
  mockProgress = { running: true, run: 7, visited: 3, total: 40 };
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  forgetPendingBulkExport();
  alert.mockRestore();
  jest.useRealTimers();
});

async function flush() {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(10);
  });
}

it('stops the running export inside the wait and shares nothing', async () => {
  stoppableWrite();
  const { result, unmount } = await renderHook(() => useBulkExport());

  let tapped!: Promise<void>;
  await act(async () => {
    tapped = result.current.exportAll();
    await jest.advanceTimersByTimeAsync(300);
  });
  expect(result.current.isExporting).toBe(true);

  await act(async () => {
    result.current.cancel();
    await tapped;
  });
  await flush();

  expect(mockCancelRun).toHaveBeenCalledWith(7);
  expect(mockShare).not.toHaveBeenCalled();
  expect(alert).not.toHaveBeenCalled();
  expect(result.current.cancelled).toBe(true);
  expect(result.current.stillRunning).toBe(false);
  await unmount();
});

it('stops an export whose wait lapsed and clears the still-running line', async () => {
  stoppableWrite();
  const { result, unmount } = await renderHook(() => useBulkExport());

  await act(async () => {
    const tapped = result.current.exportAll();
    await jest.advanceTimersByTimeAsync(PAST_THE_WAIT_MS);
    await tapped;
  });
  expect(result.current.stillRunning).toBe(true);

  await act(async () => {
    result.current.cancel();
  });
  await flush();

  expect(mockCancelRun).toHaveBeenCalledWith(7);
  expect(mockShare).not.toHaveBeenCalled();
  expect(alert).not.toHaveBeenCalled();
  expect(result.current.stillRunning).toBe(false);
  expect(result.current.cancelled).toBe(true);
  await unmount();
});

it('asks nothing of the engine with no export running', async () => {
  mockProgress = { running: false, visited: 0, total: 0 };
  const { result, unmount } = await renderHook(() => useBulkExport());

  await act(async () => {
    result.current.cancel();
  });

  expect(mockCancelRun).not.toHaveBeenCalled();
  expect(result.current.cancelled).toBe(false);
  await unmount();
});

it('forgets the cancelled line when the next export starts', async () => {
  stoppableWrite();
  const { result, unmount } = await renderHook(() => useBulkExport());
  await act(async () => {
    const tapped = result.current.exportAll();
    await jest.advanceTimersByTimeAsync(300);
    result.current.cancel();
    await tapped;
  });
  await flush();
  expect(result.current.cancelled).toBe(true);

  mockRunBulkExport.mockResolvedValueOnce({
    exported: 1,
    noTrack: 0,
    trimmed: 0,
    failed: 0,
    totalBytes: 10,
  });
  await act(async () => {
    await result.current.exportAll();
  });

  expect(result.current.cancelled).toBe(false);
  expect(mockShare).toHaveBeenCalledTimes(1);
  await unmount();
});
