/**
 * Scenario: a record backup is writing when the athlete starts a clear. The
 * clear takes a rollback copy first, and Rust runs that copy under the same
 * backup slot, refusing a second claim with `Busy`.
 *
 * Expected behaviour: the rollback copy waits for the backup to end and the
 * clear goes ahead, rather than the clear being refused for a backup that is
 * working.
 */

import { withDatabaseSnapshot } from '@/features/settings/lib/clearSnapshot';
import { inBackupSlot } from '@/features/settings/lib/backupSlot';

jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  copyAsync: jest.fn(async () => {}),
  deleteAsync: jest.fn(async () => {}),
  getInfoAsync: jest.fn(async () => ({ exists: false })),
}));

const DB = '/data/routes.db';

/** Rust's slot: a claim while another write holds it is refused. */
function slotEngine() {
  let held = false;
  let release: () => void = () => {};
  const claim = (hold: boolean) => {
    if (held) {
      return Promise.reject({ tag: 'Busy', inner: { msg: 'A backup is already running' } });
    }
    held = true;
    if (!hold) {
      held = false;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      release = () => {
        held = false;
        resolve();
      };
    });
  };
  return {
    runRecordBackup: jest.fn(() => claim(true)),
    writeClearSnapshot: jest.fn(() => claim(false)),
    destroyEngine: jest.fn(),
    initWithPath: jest.fn(() => true),
    release: () => release(),
  };
}

it('takes the rollback copy once a running backup has ended', async () => {
  const engine = slotEngine();
  const backup = inBackupSlot(() => engine.runRecordBackup());
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(engine.runRecordBackup).toHaveBeenCalledTimes(1);
  const work = jest.fn(async () => 'cleared');

  const clearing = withDatabaseSnapshot(engine, DB, work);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(work).not.toHaveBeenCalled();

  engine.release();
  await backup;

  await expect(clearing).resolves.toBe('cleared');
  expect(engine.writeClearSnapshot).toHaveBeenCalledTimes(1);
  expect(work).toHaveBeenCalledTimes(1);
});

it('takes the rollback copy after a backup that failed', async () => {
  const engine = slotEngine();
  const backup = inBackupSlot(() => Promise.reject(new Error('disk full')));
  await expect(backup).rejects.toThrow('disk full');

  await expect(withDatabaseSnapshot(engine, DB, async () => 'cleared')).resolves.toBe('cleared');
});
