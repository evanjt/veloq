/**
 * Scenario: a finished bulk export is handed to the share sheet. On Android
 * the share resolves when the chosen target returns or moves to its own task,
 * often before a mail draft or a cloud upload has read the file.
 *
 * Expected behaviour: the archive outlives the share and is swept before the
 * next one is written, and an archive that skipped rides says so before the
 * share sheet opens, with a way not to send it.
 */

import { bulkExportActivities } from '@/features/settings/lib/bulkExport';
import { sweepIdleBackupFiles } from '@/features/settings/lib/backupCache';

const mockFiles = new Set<string>();
const mockRunBulkExport = jest.fn();
const mockShare = jest.fn();

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    runBulkExport: (format: unknown, path: string) => mockRunBulkExport(format, path),
    bulkExportProgress: () => ({ running: false, visited: 0, total: 0 }),
  }),
}));

jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  cacheDirectory: 'file:///cache/',
  documentDirectory: 'file:///docs/',
  makeDirectoryAsync: async () => undefined,
  readDirectoryAsync: async (dir: string) =>
    [...mockFiles].filter((uri) => uri.startsWith(dir)).map((uri) => uri.slice(dir.length)),
  deleteAsync: async (uri: string) => {
    mockFiles.delete(uri);
  },
}));

jest.mock('@/features/settings/lib/shareFile', () => ({
  shareExistingFile: (...args: unknown[]) => mockShare(...args),
}));

const written = (skips: Partial<Record<'noTrack' | 'trimmed' | 'failed', number>> = {}) => ({
  exported: 30,
  noTrack: 0,
  trimmed: 0,
  failed: 0,
  totalBytes: 2048,
  ...skips,
});

/** The Rust write, which leaves its file where it was told to. */
function writesTheArchive(skips?: Partial<Record<'noTrack' | 'trimmed' | 'failed', number>>) {
  mockRunBulkExport.mockImplementationOnce(async (_format: unknown, path: string) => {
    mockFiles.add(`file://${path}`);
    return written(skips);
  });
}

const archiveOn = (day: string) => `file:///cache/exports/veloq-activities-${day}.zip`;

beforeEach(() => {
  mockFiles.clear();
  mockRunBulkExport.mockReset();
  mockShare.mockReset().mockResolvedValue(undefined);
  jest.useFakeTimers({ now: new Date(2026, 3, 14, 9, 0) });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('the archive a share was handed', () => {
  it('is still there after the share sheet returns', async () => {
    writesTheArchive();

    await bulkExportActivities();

    expect(mockShare).toHaveBeenCalledWith(archiveOn('2026-04-14'), 'zip', expect.anything());
    expect(mockFiles.has(archiveOn('2026-04-14'))).toBe(true);
  });

  it('is swept before the next export writes its own', async () => {
    writesTheArchive();
    await bulkExportActivities();

    jest.setSystemTime(new Date(2026, 3, 15, 9, 0));
    let presentDuringWrite = true;
    mockRunBulkExport.mockImplementationOnce(async (_format: unknown, path: string) => {
      presentDuringWrite = mockFiles.has(archiveOn('2026-04-14'));
      mockFiles.add(`file://${path}`);
      return written();
    });
    await bulkExportActivities();

    expect(presentDuringWrite).toBe(false);
    expect([...mockFiles]).toEqual([archiveOn('2026-04-15')]);
  });

  it('is swept at launch, and other files in the directory are left alone', async () => {
    writesTheArchive();
    await bulkExportActivities();
    mockFiles.add('file:///cache/exports/veloq-activities-2026-04-13.geojson');
    mockFiles.add('file:///cache/exports/Morning Ride.gpx');

    await sweepIdleBackupFiles();

    expect([...mockFiles]).toEqual(['file:///cache/exports/Morning Ride.gpx']);
  });
});

describe('an archive that skipped rides', () => {
  it('shows the tally before the share sheet opens', async () => {
    writesTheArchive({ noTrack: 2 });
    const order: string[] = [];
    const confirmSkipped = jest.fn(async () => {
      order.push('tally');
      return true;
    });
    mockShare.mockImplementation(async () => {
      order.push('share');
    });

    const outcome = await bulkExportActivities(undefined, undefined, undefined, confirmSkipped);

    expect(confirmSkipped).toHaveBeenCalledWith(
      expect.objectContaining({ exported: 30, noTrack: 2, trimmed: 0, failed: 0, kind: 'gpx' })
    );
    expect(order).toEqual(['tally', 'share']);
    expect(outcome).toMatchObject({ state: 'complete', noTrack: 2 });
  });

  it('is not shared when the athlete cancels at the tally', async () => {
    writesTheArchive({ trimmed: 1 });

    const outcome = await bulkExportActivities(undefined, undefined, undefined, async () => false);

    expect(mockShare).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ state: 'complete', trimmed: 1 });
  });

  it('asks nothing when nothing was skipped', async () => {
    writesTheArchive();
    const confirmSkipped = jest.fn(async () => true);

    await bulkExportActivities(undefined, undefined, undefined, confirmSkipped);

    expect(confirmSkipped).not.toHaveBeenCalled();
    expect(mockShare).toHaveBeenCalledTimes(1);
  });
});
