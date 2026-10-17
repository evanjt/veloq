/**
 * Scenario: a record zip reaches a backup folder under one of three names, the
 * one every write now takes, the date-only name an older manual export took,
 * and the UTC instant an older automatic run took.
 *
 * Expected behaviour: every write takes the one name, and the listing reads
 * the instant out of all three, so a zip the athlete saved there by hand is
 * offered for restore beside the ones a run wrote.
 */

import {
  backupFileName,
  backupNameTimestamp,
} from '@/features/settings/lib/autobackup/backends/backupName';

/** An instant given in the zone the test runs in, as a backup's ISO timestamp. */
function localInstant(...parts: [number, number, number, number, number, number]): string {
  const [y, mo, d, h, mi, s] = parts;
  return new Date(y, mo - 1, d, h, mi, s).toISOString();
}

describe('backupFileName', () => {
  it('names the zip by its local date and time, to the second', () => {
    expect(backupFileName(localInstant(2026, 3, 14, 7, 30, 5))).toBe(
      'veloq-backup-2026-03-14-073005.zip'
    );
  });

  it('gives two runs a second apart two names', () => {
    expect(backupFileName(localInstant(2026, 3, 14, 7, 30, 5))).not.toBe(
      backupFileName(localInstant(2026, 3, 14, 7, 30, 6))
    );
  });

  it('reads back the instant it was named from', () => {
    const at = localInstant(2026, 12, 31, 23, 59, 59);
    expect(backupNameTimestamp(backupFileName(at))).toBe(at);
  });
});

describe('backupNameTimestamp', () => {
  it('reads the local date and time of the current name', () => {
    expect(backupNameTimestamp('veloq-backup-2026-10-10-184512.zip')).toBe(
      localInstant(2026, 10, 10, 18, 45, 12)
    );
  });

  it('reads an older manual export as the start of its local day', () => {
    expect(backupNameTimestamp('veloq-backup-2026-10-10.zip')).toBe(
      localInstant(2026, 10, 10, 0, 0, 0)
    );
  });

  it('reads an older automatic run as its UTC instant', () => {
    expect(backupNameTimestamp('veloq-2026-03-14T06-30-00-250Z.zip')).toBe(
      '2026-03-14T06:30:00.250Z'
    );
  });

  it.each([
    ['veloq-backup-2026-10-10 (1).zip', localInstant(2026, 10, 10, 0, 0, 0)],
    ['veloq-backup-2026-10-10-184512 (2).zip', localInstant(2026, 10, 10, 18, 45, 12)],
    ['veloq-2026-03-14T06-30-00-250Z (1).zip', '2026-03-14T06:30:00.250Z'],
  ])('reads %s, the copy a file manager names beside a second save', (name, instant) => {
    expect(backupNameTimestamp(name)).toBe(instant);
  });

  it.each([
    'holiday.jpg',
    'veloq-backup-2026-10-10.zip.meta.json',
    'veloq-backup-2026-10-10.veloqdb',
    'veloq-backup-2026-13-10.zip',
    'veloq-backup-2026-02-30-120000.zip',
    'veloq-backup-2026-10-10-246000.zip',
    'veloq-2026-03-14T06-30-00-000Z.zip.part',
    'veloq-decisions.zip',
    'veloq-backup-.zip',
  ])('lists nothing for %s', (name) => {
    expect(backupNameTimestamp(name)).toBeNull();
  });
});
