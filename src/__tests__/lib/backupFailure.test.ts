/**
 * Scenario: the backup row rendered `error.message` for anything that was not
 * a transfer failure. An engine failure crosses as a typed variant carrying
 * Rust's own English, so "Engine not initialised" and "Database error: disk
 * I/O error" reached the athlete untranslated and read the same.
 *
 * Expected behaviour: a variant becomes the line naming that variant, and only
 * a failure with no variant falls back to its message.
 */

import { describeBackupFailure } from '@/features/settings/lib/backupFailure';
import { transferFailure } from '@/features/settings/lib/autobackup/backends/errors';

describe('describing a failed backup', () => {
  it('names the engine variant rather than passing Rust English through', () => {
    const notOpen = Object.assign(new Error('Engine not initialised'), {
      tag: 'NotInitialized',
    });
    const database = Object.assign(new Error('Database error: disk I/O error'), {
      tag: 'Database',
      inner: { msg: 'disk I/O error' },
    });

    expect(describeBackupFailure(notOpen)).toEqual({
      kind: 'key',
      key: 'engine.failure.notOpen',
    });
    expect(describeBackupFailure(database)).toEqual({
      kind: 'key',
      key: 'engine.failure.database',
    });
  });

  it('keeps a transfer failure on its own line', () => {
    expect(describeBackupFailure(transferFailure('PUT', 403))).toEqual({
      kind: 'key',
      key: 'backup.backupFailedAuth',
    });
  });

  it('falls back to the message for a failure that is neither', () => {
    expect(describeBackupFailure(new Error('no space left on device'))).toEqual({
      kind: 'message',
      message: 'no space left on device',
    });
  });

  it('has a line for a failure that is not an Error at all', () => {
    expect(describeBackupFailure('nope')).toEqual({
      kind: 'key',
      key: 'backup.backupFailedMessage',
    });
    expect(describeBackupFailure(new Error(''))).toEqual({
      kind: 'key',
      key: 'backup.backupFailedMessage',
    });
  });
});
