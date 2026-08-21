/**
 * Scenario: restore reads a file the user picked, so its shape is not
 * guaranteed and it may have been hand-edited.
 *
 * Expected behaviour: a malformed root is rejected with the normal error rather
 * than throwing a TypeError, and only keys the export writes are restored.
 */
jest.mock('@/shared/native/routeEngine', () => ({
  getRouteEngine: () => null,
  getRouteDbPath: () => '/tmp/routes.db',
  getNativeModule: () => null,
}));

import { restoreBackup } from '@/features/settings/lib/backup';

describe('restoreBackup input validation', () => {
  it('rejects a file containing bare null without a TypeError', async () => {
    await expect(restoreBackup('null')).rejects.toThrow('Corrupt backup: missing version field');
  });

  it('rejects a JSON array', async () => {
    await expect(restoreBackup('[]')).rejects.toThrow('Corrupt backup: missing version field');
  });

  it('rejects a bare string', async () => {
    await expect(restoreBackup('"backup"')).rejects.toThrow(
      'Corrupt backup: missing version field'
    );
  });

  it('rejects a non-numeric version', async () => {
    await expect(restoreBackup(JSON.stringify({ version: 'one' }))).rejects.toThrow(
      'Corrupt backup: missing version field'
    );
  });

  it('still rejects malformed JSON with the format error', async () => {
    await expect(restoreBackup('not json')).rejects.toThrow('Invalid backup file format');
  });
});
