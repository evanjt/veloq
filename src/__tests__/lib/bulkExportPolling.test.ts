/**
 * Scenario: a bulk export of a whole library. Rust writes the file on a thread
 * of its own, so the export is started and then polled.
 *
 * Expected behaviour: the JS thread never waits on the write, every poll
 * reports what has been exported so far, and the share only happens once the
 * export reads complete.
 */

import { bulkExportActivities, runExport } from '@/features/settings/lib/bulkExport';
import { BulkExportFormat } from '../__shared__/veloqrsStub';

const mockStartBulkExport = jest.fn();
const mockShareAsync = jest.fn();
const mockDeleteAsync = jest.fn();
let mockPolls: {
  state: string;
  exported: number;
  total: number;
  skipped: number;
  totalBytes: number;
}[] = [];

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    startBulkExport: (format: unknown, path: string) => mockStartBulkExport(format, path),
    pollBulkExport: () =>
      mockPolls.shift() ?? { state: 'idle', exported: 0, total: 0, skipped: 0, totalBytes: 0 },
  }),
}));

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  deleteAsync: (...args: unknown[]) => mockDeleteAsync(...args),
}));

jest.mock('expo-sharing', () => ({
  shareAsync: (...args: unknown[]) => mockShareAsync(...args),
}));

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

const running = (exported: number, total: number) => ({
  state: 'running',
  exported,
  total,
  skipped: 0,
  totalBytes: 0,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mockPolls = [];
});

afterEach(() => {
  jest.useRealTimers();
});

/** Let the poll loop's timers run while the export promise is in flight. */
async function settle(promise: Promise<unknown>) {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
    jest.advanceTimersByTime(250);
  }
  return promise;
}

test('the export is polled to completion and reports progress as it goes', async () => {
  mockPolls = [
    running(0, 3),
    running(2, 3),
    { state: 'complete', exported: 3, total: 3, skipped: 1, totalBytes: 4096 },
  ];
  const progress: { current: number; total: number }[] = [];

  const result = await settle(
    runExport(BulkExportFormat.Gpx, '/cache/all.zip', (p) =>
      progress.push({ current: p.current, total: p.total })
    )
  );

  expect(result).toEqual({ exported: 3, skipped: 1, totalBytes: 4096 });
  expect(mockStartBulkExport).toHaveBeenCalledWith(BulkExportFormat.Gpx, '/cache/all.zip');
  expect(progress).toContainEqual({ current: 2, total: 3 });
});

test('a slot that never leaves idle fails rather than spinning forever', async () => {
  mockPolls = [];
  await expect(settle(bulkExportActivities())).rejects.toThrow('Export did not start');
  expect(mockShareAsync).not.toHaveBeenCalled();
});

test('a failing poll propagates and nothing is shared', async () => {
  mockPolls = [running(0, 2)];
  const engine = jest.requireMock('@/shared/native/engine');
  const original = engine.getEngine;
  engine.getEngine = () => ({
    startBulkExport: mockStartBulkExport,
    pollBulkExport: () => {
      throw new Error('Database error: disk full');
    },
  });

  await expect(settle(bulkExportActivities())).rejects.toThrow('disk full');
  expect(mockShareAsync).not.toHaveBeenCalled();
  engine.getEngine = original;
});
