/**
 * Scenario: `withDatabaseSnapshot` rolls a failed clear back by copying a
 * standalone backup over the live database. That database is WAL,
 * so a `-wal` and `-shm` can sit beside it, and `destroyEngine` only deletes
 * them when it closes the last connection: the detection worker and the export
 * source each hold one on a thread of their own.
 *
 * Expected behaviour: the rollback clears the sidecars before the copy lands,
 * the way the restore path already does, so no frame from the database being
 * replaced is applied onto the one replacing it.
 */

import * as FileSystem from 'expo-file-system/legacy';

import { withDatabaseSnapshot } from '@/features/settings/lib/clearSnapshot';

jest.mock('expo-file-system/legacy', () => ({
  copyAsync: jest.fn(async () => {}),
  deleteAsync: jest.fn(async () => {}),
  getInfoAsync: jest.fn(async () => ({ exists: true })),
}));

jest.mock('@/features/settings/lib/runBackup', () => ({
  runDatabaseBackup: jest.fn(async () => {}),
}));

const DB = '/data/routes.db';

function engine() {
  return {
    startBackup: jest.fn(),
    getBackupProgress: jest.fn(),
    destroyEngine: jest.fn(),
    initWithPath: jest.fn(() => true),
  } as unknown as Parameters<typeof withDatabaseSnapshot>[0];
}

/** Call order across the two mocked modules, so "before" is actually asserted. */
function callOrder(): string[] {
  const deletes = (FileSystem.deleteAsync as jest.Mock).mock.calls.map(
    (c) => `delete:${String(c[0])}`
  );
  const copies = (FileSystem.copyAsync as jest.Mock).mock.calls.map(
    (c) => `copy:${String((c[0] as { to: string }).to)}`
  );
  return [...deletes, ...copies];
}

describe('clear rollback', () => {
  beforeEach(() => {
    (FileSystem.copyAsync as jest.Mock).mockClear();
    (FileSystem.deleteAsync as jest.Mock).mockClear();
  });

  it('clears the live sidecars before the snapshot lands on the database', async () => {
    await expect(
      withDatabaseSnapshot(engine(), DB, async () => {
        throw new Error('clear failed');
      })
    ).rejects.toThrow('clear failed');

    const deleted = (FileSystem.deleteAsync as jest.Mock).mock.calls.map((c) => String(c[0]));
    expect(deleted).toContain(`file://${DB}-wal`);
    expect(deleted).toContain(`file://${DB}-shm`);

    const order = callOrder();
    expect(order.indexOf(`delete:file://${DB}-wal`)).toBeLessThan(order.length);
    expect(
      (FileSystem.deleteAsync as jest.Mock).mock.invocationCallOrder[
        deleted.indexOf(`file://${DB}-wal`)
      ]
    ).toBeLessThan((FileSystem.copyAsync as jest.Mock).mock.invocationCallOrder[0]);
  });

  it('leaves the sidecars alone when the work succeeds', async () => {
    await withDatabaseSnapshot(engine(), DB, async () => 'done');

    const deleted = (FileSystem.deleteAsync as jest.Mock).mock.calls.map((c) => String(c[0]));
    expect(deleted).not.toContain(`file://${DB}-wal`);
    expect(FileSystem.copyAsync).not.toHaveBeenCalled();
  });
});
