/**
 * Scenario: a bulk export of a whole library. Rust writes the file on a thread
 * of its own and answers with a promise, and the row above it shows what it has
 * got through.
 *
 * Expected behaviour: the JS thread never waits on the write, the progress read
 * reports what has been exported so far, the share only happens once the write
 * has finished, and a write that outlives the foreground budget is reported as
 * still going rather than failed.
 */

import {
  bulkExportActivities,
  resumePendingBulkExport,
  runExport,
} from '@/features/settings/lib/bulkExport';
import { BulkExportFormat } from '../__shared__/veloqrsStub';

const mockRunBulkExport = jest.fn();
const mockShareAsync = jest.fn();
const mockDeleteAsync = jest.fn();
let mockProgress = { running: false, exported: 0, total: 0 };

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    runBulkExport: (format: unknown, path: string) => mockRunBulkExport(format, path),
    bulkExportProgress: () => mockProgress,
  }),
}));

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  deleteAsync: (...args: unknown[]) => mockDeleteAsync(...args),
}));

jest.mock('expo-sharing', () => ({
  shareAsync: (...args: unknown[]) => mockShareAsync(...args),
}));

// The share sheet is loaded with a dynamic import, which the test VM cannot
// run, and it is the OS's half of the export rather than this module's.
jest.mock('@/features/settings/lib/shareFile', () => ({
  shareExistingFile: (...args: unknown[]) => mockShareAsync(...args),
}));

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

/** A write nobody resolves, which is what a ceiling is for. */
const neverFinishes = () => new Promise(() => {});

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mockProgress = { running: false, exported: 0, total: 0 };
});

afterEach(() => {
  jest.useRealTimers();
});

test('the export is awaited and reports progress as it goes', async () => {
  mockProgress = { running: true, exported: 2, total: 3 };
  mockRunBulkExport.mockImplementation(
    () =>
      new Promise((resolve) =>
        setTimeout(() => resolve({ exported: 3, skipped: 1, totalBytes: 4096 }), 600)
      )
  );
  const progress: { current: number; total: number }[] = [];

  const exporting = runExport(BulkExportFormat.Gpx, '/cache/all.zip', (p) =>
    progress.push({ current: p.current, total: p.total })
  );
  await jest.advanceTimersByTimeAsync(1_000);

  await expect(exporting).resolves.toEqual({
    state: 'complete',
    exported: 3,
    skipped: 1,
    totalBytes: 4096,
  });
  expect(mockRunBulkExport).toHaveBeenCalledWith(BulkExportFormat.Gpx, '/cache/all.zip');
  expect(progress).toContainEqual({ current: 2, total: 3 });
});

test('a failing write propagates and nothing is shared', async () => {
  mockRunBulkExport.mockRejectedValue(new Error('Database error: disk full'));

  await expect(bulkExportActivities()).rejects.toThrow('disk full');
  expect(mockShareAsync).not.toHaveBeenCalled();
});

/**
 * Scenario: the Rust export worker neither finishes nor fails. The wait had no
 * budget, so the spinner never stopped.
 *
 * Expected behaviour: the wait has a budget, and the budget is a parameter so a
 * test can shorten it.
 */
describe('an export that never ends', () => {
  it('stops watching a run that is still writing past its budget', async () => {
    mockRunBulkExport.mockImplementation(neverFinishes);

    const exporting = runExport(BulkExportFormat.Gpx, '/cache/all.zip', undefined, 1_000);
    await jest.advanceTimersByTimeAsync(2_000);

    await expect(exporting).resolves.toMatchObject({ state: 'running' });
  });
});

/**
 * Scenario: iOS suspends the app while an export runs. No timer fires while it
 * is away, so a budget read off the wall clock is spent by a resume nobody was
 * watching.
 *
 * Expected behaviour: the budget counts the time the app was awake, so a
 * suspension costs the export nothing.
 */
describe('an export the app was suspended during', () => {
  it('is not failed by the clock the resume brings back', async () => {
    jest.useRealTimers();
    const realNow = Date.now;
    let at = realNow();
    Date.now = () => at;

    let settle: (written: unknown) => void = () => {};
    mockRunBulkExport.mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        })
    );

    const exporting = runExport(BulkExportFormat.Gpx, '/cache/all.zip', undefined, 60_000);

    at += 180_000;
    for (let tick = 0; tick < 4; tick += 1) {
      at += 500;
      await Promise.resolve();
    }
    settle({ exported: 3, skipped: 0, totalBytes: 512 });

    await expect(exporting).resolves.toEqual({
      state: 'complete',
      exported: 3,
      skipped: 0,
      totalBytes: 512,
    });
    Date.now = realNow;
  });
});

/**
 * Scenario: an export of a whole library outlives the minute a foreground wait
 * is given. Rust keeps writing on its own thread either way.
 *
 * Expected behaviour: the wait ends saying the export is still running, not
 * that it failed, and the write and its destination survive the screen so the
 * share can be offered when the athlete comes back.
 */
describe('an export that outlives the foreground budget', () => {
  it('shares nothing at the cap and offers the file once the write finishes', async () => {
    let settle: (written: unknown) => void = () => {};
    mockRunBulkExport.mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        })
    );

    const exporting = bulkExportActivities(undefined, 1_000);
    await jest.advanceTimersByTimeAsync(2_000);
    await expect(exporting).resolves.toEqual({ state: 'still-running' });
    expect(mockShareAsync).not.toHaveBeenCalled();

    settle({ exported: 3, skipped: 0, totalBytes: 2048 });
    await Promise.resolve();
    await Promise.resolve();

    await expect(resumePendingBulkExport()).resolves.toEqual({
      state: 'complete',
      exported: 3,
      skipped: 0,
    });
    expect(mockShareAsync).toHaveBeenCalledTimes(1);
    // The same file the lapsed run was writing, not a second export.
    expect(mockRunBulkExport).toHaveBeenCalledTimes(1);
  });

  it('keeps the file owed while the write is still going', async () => {
    mockRunBulkExport.mockImplementation(neverFinishes);

    const exporting = bulkExportActivities(undefined, 1_000);
    await jest.advanceTimersByTimeAsync(2_000);
    await exporting;

    await expect(resumePendingBulkExport()).resolves.toEqual({ state: 'still-running' });
    expect(mockShareAsync).not.toHaveBeenCalled();
  });

  it('owes nothing after an export the screen waited out', async () => {
    mockRunBulkExport.mockResolvedValue({ exported: 1, skipped: 0, totalBytes: 32 });

    await expect(bulkExportActivities()).resolves.toEqual({
      state: 'complete',
      exported: 1,
      skipped: 0,
    });

    await expect(resumePendingBulkExport()).resolves.toEqual({ state: 'nothing-pending' });
  });
});
