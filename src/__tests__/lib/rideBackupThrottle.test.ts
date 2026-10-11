/**
 * Scenario: a backgrounded ride writes its crash backup from location batches,
 * at most once an interval. On a nearly full device the write fails.
 *
 * Expected behaviour: only a write that landed holds the next one back. A
 * failed write leaves the next batch free to try again, rather than the
 * throttle recording a backup that never reached the disk.
 */

import { BACKUP_INTERVAL_MS } from '@/features/recording/lib/constants';

const mockSave = jest.fn<Promise<boolean>, [unknown]>();

jest.mock('@/features/recording/lib/storage/recordingBackup', () => ({
  buildRecordingBackup: () => ({ startTime: 1 }),
  saveRecordingBackup: (backup: unknown) => mockSave(backup),
}));

const T0 = 1_700_000_000_000;

function loadRideBackup(): typeof import('@/features/recording/lib/rideBackup') {
  let loaded: typeof import('@/features/recording/lib/rideBackup') | undefined;
  jest.isolateModules(() => {
    loaded = require('@/features/recording/lib/rideBackup');
  });
  return loaded!;
}

beforeEach(() => {
  mockSave.mockReset();
});

describe('ride backup throttle', () => {
  it('lets the next batch retry a write that failed', async () => {
    const { writeRideBackup, writeRideBackupIfDue } = loadRideBackup();
    mockSave.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    expect(await writeRideBackup(T0)).toBe(false);
    expect(await writeRideBackupIfDue(T0 + 1_000)).toBe(true);

    expect(mockSave).toHaveBeenCalledTimes(2);
  });

  it('keeps retrying while every write fails', async () => {
    const { writeRideBackupIfDue } = loadRideBackup();
    mockSave.mockResolvedValue(false);

    await writeRideBackupIfDue(T0);
    await writeRideBackupIfDue(T0 + 1_000);
    await writeRideBackupIfDue(T0 + 2_000);

    expect(mockSave).toHaveBeenCalledTimes(3);
  });

  it('holds the next batch back for an interval after a write that landed', async () => {
    const { writeRideBackup, writeRideBackupIfDue } = loadRideBackup();
    mockSave.mockResolvedValue(true);

    await writeRideBackup(T0);
    expect(await writeRideBackupIfDue(T0 + 1_000)).toBe(false);
    expect(await writeRideBackupIfDue(T0 + BACKUP_INTERVAL_MS)).toBe(true);

    expect(mockSave).toHaveBeenCalledTimes(2);
  });

  it('measures the interval from the last write that landed, not the last attempt', async () => {
    const { writeRideBackupIfDue } = loadRideBackup();
    mockSave.mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockResolvedValue(true);

    await writeRideBackupIfDue(T0);
    await writeRideBackupIfDue(T0 + BACKUP_INTERVAL_MS);
    expect(await writeRideBackupIfDue(T0 + BACKUP_INTERVAL_MS + 1_000)).toBe(true);

    expect(mockSave).toHaveBeenCalledTimes(3);
  });
});
