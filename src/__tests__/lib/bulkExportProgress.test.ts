/**
 * Scenario: a bulk export of a whole library. The write runs on a Rust thread
 * with a connection of its own, and the row above it is meant to show what it
 * has got through.
 *
 * Expected behaviour: the export is started once, polled until it reports
 * complete, and every poll is reported as a count. The JavaScript thread is
 * never inside the write, so the row paints while it runs.
 */

import {
  bulkExportActivities,
  bulkExportActivitiesGeoJson,
  type BulkExportProgress,
} from '@/features/settings/lib/bulkExport';

const mockStartBulkExport = jest.fn();
const mockPollBulkExport = jest.fn();

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    startBulkExport: mockStartBulkExport,
    pollBulkExport: mockPollBulkExport,
  }),
}));

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  deleteAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/features/settings/lib/shareFile', () => ({
  shareExistingFile: jest.fn().mockResolvedValue(undefined),
}));

const running = (exported: number) => ({
  state: 'running',
  exported,
  total: 402,
  skipped: 0,
  totalBytes: 0,
});

const complete = {
  state: 'complete',
  exported: 402,
  total: 402,
  skipped: 6,
  totalBytes: 8_400_000,
};

beforeEach(() => {
  jest.useFakeTimers();
  mockStartBulkExport.mockClear();
  mockPollBulkExport.mockReset();
  mockPollBulkExport.mockReturnValueOnce(running(0)).mockReturnValueOnce(running(200));
  mockPollBulkExport.mockReturnValue(complete);
});

afterEach(() => {
  jest.useRealTimers();
});

/** Drive the poll loop's timers while the export promise is in flight. */
async function settle<T>(promise: Promise<T>): Promise<T> {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
    jest.advanceTimersByTime(250);
  }
  return promise;
}

describe.each([
  ['gpx', bulkExportActivities] as const,
  ['geojson', bulkExportActivitiesGeoJson] as const,
])('%s bulk export', (_format, run) => {
  it('starts the export once and polls it to completion', async () => {
    const result = await settle(run());

    expect(mockStartBulkExport).toHaveBeenCalledTimes(1);
    expect(mockPollBulkExport.mock.calls.length).toBeGreaterThan(1);
    expect(result).toEqual({ exported: 402, skipped: 6 });
  });

  it('reports the count as it climbs, then the bytes it shared', async () => {
    const seen: BulkExportProgress[] = [];
    await settle(run((progress) => seen.push(progress)));

    expect(seen.map((p) => p.phase)).toEqual(['generating', 'generating', 'generating', 'sharing']);
    expect(seen.map((p) => p.current)).toEqual([0, 0, 200, 402]);
    expect(seen[2].total).toBe(402);
    expect(seen.at(-1)?.sizeBytes).toBe(8_400_000);
  });
});
