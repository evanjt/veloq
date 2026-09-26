/**
 * Scenario: a bulk export of a whole library. The write runs on a Rust thread
 * with a connection of its own, and the row above it is meant to show what it
 * has got through.
 *
 * Expected behaviour: the export is started once and awaited, the counters are
 * read on a timer while it runs and reported as counts, and the final report is
 * the bytes it shared. The JavaScript thread is never inside the write, so the
 * row paints while it runs.
 */

import {
  bulkExportActivities,
  bulkExportActivitiesGeoJson,
  type BulkExportProgress,
} from '@/features/settings/lib/bulkExport';

const mockRunBulkExport = jest.fn();
const mockBulkExportProgress = jest.fn();

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    runBulkExport: mockRunBulkExport,
    bulkExportProgress: mockBulkExportProgress,
  }),
}));

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  deleteAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/features/settings/lib/shareFile', () => ({
  shareExistingFile: jest.fn().mockResolvedValue(undefined),
}));

const written = { exported: 402, skipped: 6, totalBytes: 8_400_000 };

/** The counters climbing, the way the writing thread moves them. */
const climbing = (exported: number) => ({ running: true, exported, total: 402 });

beforeEach(() => {
  jest.useFakeTimers();
  mockRunBulkExport.mockReset();
  mockBulkExportProgress.mockReset();
  mockBulkExportProgress
    .mockReturnValueOnce(climbing(0))
    .mockReturnValueOnce(climbing(200))
    .mockReturnValue({ running: false, exported: 0, total: 0 });
});

afterEach(() => {
  jest.useRealTimers();
});

/** Let the progress ticker fire twice while the write is in flight. */
function landsAfterTwoTicks() {
  mockRunBulkExport.mockImplementation(
    () => new Promise((resolve) => setTimeout(() => resolve(written), 600))
  );
}

describe.each([
  ['gpx', bulkExportActivities] as const,
  ['geojson', bulkExportActivitiesGeoJson] as const,
])('%s bulk export', (_format, run) => {
  it('starts the export once and waits for it', async () => {
    landsAfterTwoTicks();

    const exporting = run();
    await jest.advanceTimersByTimeAsync(1_000);

    expect(mockRunBulkExport).toHaveBeenCalledTimes(1);
    await expect(exporting).resolves.toEqual({ state: 'complete', exported: 402, skipped: 6 });
  });

  it('reports the count as it climbs, then the bytes it shared', async () => {
    landsAfterTwoTicks();
    const seen: BulkExportProgress[] = [];

    const exporting = run((progress) => seen.push(progress));
    await jest.advanceTimersByTimeAsync(1_000);
    await exporting;

    expect(seen.map((p) => p.phase)).toEqual(['generating', 'generating', 'generating', 'sharing']);
    expect(seen.map((p) => p.current)).toEqual([0, 0, 200, 402]);
    expect(seen[2].total).toBe(402);
    expect(seen.at(-1)?.sizeBytes).toBe(8_400_000);
  });
});
