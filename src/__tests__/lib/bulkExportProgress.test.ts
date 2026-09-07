/**
 * Scenario: a bulk export freezes the JavaScript thread inside one blocking
 * FFI call, and the row above it is meant to show that something is happening.
 *
 * Expected behaviour: the row gets a paint before the freeze, and it is told
 * only what is true. There is no count to report until the call returns, so
 * the export announces the phase and the bytes and nothing else.
 */

import {
  bulkExportActivities,
  bulkExportActivitiesGeoJson,
  type BulkExportProgress,
} from '@/features/settings/lib/bulkExport';

const mockBulkExportGpx = jest.fn(() => ({ exported: 402, skipped: 6, totalBytes: 8_400_000 }));
const mockBulkExportGeoJson = jest.fn(() => ({ exported: 402, skipped: 6, totalBytes: 5_100_000 }));

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({ bulkExportGpx: mockBulkExportGpx, bulkExportGeoJson: mockBulkExportGeoJson }),
}));

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  deleteAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/features/settings/lib/shareFile', () => ({
  shareExistingFile: jest.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  mockBulkExportGpx.mockClear();
  mockBulkExportGeoJson.mockClear();
});

describe.each([
  ['gpx', bulkExportActivities, mockBulkExportGpx] as const,
  ['geojson', bulkExportActivitiesGeoJson, mockBulkExportGeoJson] as const,
])('%s bulk export', (_format, run, engineCall) => {
  it('yields to the paint before it freezes the thread', async () => {
    const seen: BulkExportProgress[] = [];
    const done = run((progress) => seen.push(progress));

    expect(seen).toHaveLength(1);
    expect(seen[0].phase).toBe('generating');
    expect(engineCall).not.toHaveBeenCalled();

    await done;
    expect(engineCall).toHaveBeenCalledTimes(1);
  });

  it('reports the phase and the bytes, and never a count it does not have', async () => {
    const seen: BulkExportProgress[] = [];
    await run((progress) => seen.push(progress));

    expect(seen.map((p) => p.phase)).toEqual(['generating', 'sharing']);
    expect(seen[0].sizeBytes).toBe(0);
    expect(seen[1].sizeBytes).toBeGreaterThan(0);
    for (const progress of seen) {
      expect(progress).not.toHaveProperty('current');
      expect(progress).not.toHaveProperty('total');
    }
  });
});
