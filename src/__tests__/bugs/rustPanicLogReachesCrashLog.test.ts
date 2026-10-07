/**
 * Scenario: the engine's panic hook appends one line per panic to
 * `veloq_panic.log` beside the database. A background thread's panic reaches no
 * JavaScript handler, so that file is its only record.
 *
 * Expected behaviour: the next launch turns each line into a fatal `rust-panic`
 * crash entry and empties the file, so Share crash log carries it and the file
 * does not grow without bound.
 */
import * as FileSystem from 'expo-file-system/legacy';

import { recoverPanicLog } from '@/features/settings/lib/databaseSidecars';
import { recordCrashes } from '@/shared/debug/crashLog';
import { excludeExistingFromBackup } from '@/shared/native/backupExclusion';

jest.mock('@/shared/native/backupExclusion', () => ({
  excludeExistingFromBackup: jest.fn(),
}));

jest.mock('@/shared/debug/crashLog', () => ({
  recordCrashes: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  getInfoAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
  deleteAsync: jest.fn(),
  writeAsStringAsync: jest.fn(),
}));

const fs = FileSystem as jest.Mocked<typeof FileSystem>;
const record = recordCrashes as jest.Mock;
const PATH = 'file:///group/veloq_panic.log';

beforeEach(() => {
  jest.clearAllMocks();
  fs.getInfoAsync.mockResolvedValue({ exists: true } as never);
});

describe('recoverPanicLog', () => {
  it('records each line as a fatal rust-panic entry, empties the file and marks it again', async () => {
    fs.readAsStringAsync.mockResolvedValue(
      '2026-10-01T08:00:00+00:00 [fetch] panic at a.rs:1:2: one\n\n2026-10-01T08:00:01+00:00 [fetch] panic at b.rs:3:4: two\n'
    );

    await recoverPanicLog('/group/routes.db');

    expect(record.mock.calls[0][0]).toEqual([
      {
        source: 'rust-panic',
        fatal: true,
        message: '2026-10-01T08:00:00+00:00 [fetch] panic at a.rs:1:2: one',
      },
      {
        source: 'rust-panic',
        fatal: true,
        message: '2026-10-01T08:00:01+00:00 [fetch] panic at b.rs:3:4: two',
      },
    ]);
    expect(fs.readAsStringAsync).toHaveBeenCalledWith(PATH);
    expect(fs.writeAsStringAsync).toHaveBeenCalledWith(PATH, '');
    expect(fs.deleteAsync).not.toHaveBeenCalled();
    expect(excludeExistingFromBackup).toHaveBeenCalledWith(PATH);
  });

  it('does nothing when no panic log exists', async () => {
    fs.getInfoAsync.mockResolvedValue({ exists: false } as never);
    await recoverPanicLog('/group/routes.db');
    expect(record).not.toHaveBeenCalled();
    expect(fs.deleteAsync).not.toHaveBeenCalled();
  });

  it('keeps the file when it cannot be read, and never throws', async () => {
    fs.readAsStringAsync.mockRejectedValue(new Error('io'));
    await expect(recoverPanicLog('/group/routes.db')).resolves.toBeUndefined();
    expect(fs.writeAsStringAsync).not.toHaveBeenCalled();
  });

  it('records only the most recent lines of a long log', async () => {
    const lines = Array.from({ length: 100 }, (_, i) => `panic ${i}`);
    fs.readAsStringAsync.mockResolvedValue(lines.join('\n'));
    await recoverPanicLog('/group/routes.db');
    expect(record.mock.calls[0][0]).toHaveLength(20);
    expect(record.mock.calls[0][0][19].message).toBe('panic 99');
    expect(fs.writeAsStringAsync).toHaveBeenCalled();
  });
});
