/**
 * Scenario: Android's own backup agent records when Auto Backup last took the
 * app, its size, the last time the payload was over Android's quota, and the
 * last restore. Android drops an over-quota payload whole and says nothing.
 *
 * Expected behaviour: the device row reads what Android did, not when Veloq
 * wrote its zip. An overrun after the last backup is shown as a failure, an
 * overrun the next backup got past is not, and a restore is shown whenever one
 * ran.
 */
import { androidAutoBackupLines } from '@/features/settings/lib/androidAutoBackupLines';
import type { AndroidAutoBackupStatus } from '@/shared/native/androidAutoBackup';

const EMPTY: AndroidAutoBackupStatus = {
  backedUpAt: null,
  backedUpBytes: null,
  quotaExceededAt: null,
  quotaExceededBytes: null,
  quotaBytes: null,
  restoredAt: null,
};

describe('androidAutoBackupLines', () => {
  it('says nothing when the build cannot ask Android', () => {
    expect(androidAutoBackupLines(null)).toEqual([]);
  });

  it('says Android has not backed up yet when nothing is recorded', () => {
    expect(androidAutoBackupLines(EMPTY)).toEqual([{ kind: 'never' }]);
  });

  it('gives the time and size of the last backup', () => {
    expect(androidAutoBackupLines({ ...EMPTY, backedUpAt: 1_000, backedUpBytes: 4_096 })).toEqual([
      { kind: 'backedUp', at: 1_000, bytes: 4_096 },
    ]);
  });

  it('shows an overrun after the last backup as a failure with both sizes', () => {
    const status = {
      ...EMPTY,
      backedUpAt: 1_000,
      backedUpBytes: 4_096,
      quotaExceededAt: 2_000,
      quotaExceededBytes: 30_000_000,
      quotaBytes: 25_000_000,
    };

    expect(androidAutoBackupLines(status)).toEqual([
      { kind: 'backedUp', at: 1_000, bytes: 4_096 },
      { kind: 'quotaExceeded', at: 2_000, bytes: 30_000_000, quotaBytes: 25_000_000 },
    ]);
  });

  it('shows an overrun on a phone Android has never backed up', () => {
    const status = {
      ...EMPTY,
      quotaExceededAt: 2_000,
      quotaExceededBytes: 30_000_000,
      quotaBytes: 25_000_000,
    };

    expect(androidAutoBackupLines(status)).toEqual([
      { kind: 'never' },
      { kind: 'quotaExceeded', at: 2_000, bytes: 30_000_000, quotaBytes: 25_000_000 },
    ]);
  });

  it('drops an overrun a later backup got past', () => {
    const status = {
      ...EMPTY,
      backedUpAt: 3_000,
      backedUpBytes: 4_096,
      quotaExceededAt: 2_000,
      quotaExceededBytes: 30_000_000,
      quotaBytes: 25_000_000,
    };

    expect(androidAutoBackupLines(status)).toEqual([{ kind: 'backedUp', at: 3_000, bytes: 4_096 }]);
  });

  it('adds a restore when one ran', () => {
    expect(
      androidAutoBackupLines({ ...EMPTY, backedUpAt: 1_000, backedUpBytes: 4_096, restoredAt: 500 })
    ).toEqual([
      { kind: 'backedUp', at: 1_000, bytes: 4_096 },
      { kind: 'restored', at: 500 },
    ]);
  });

  it('reads a backup recorded without a size as no bytes rather than dropping it', () => {
    expect(androidAutoBackupLines({ ...EMPTY, backedUpAt: 1_000 })).toEqual([
      { kind: 'backedUp', at: 1_000, bytes: 0 },
    ]);
  });
});
