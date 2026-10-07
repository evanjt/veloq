/**
 * Scenario: on iOS everything in Documents and the App Group container rides in
 * the iCloud device backup unless it carries the exclusion attribute. The local
 * backup carrier keeps older generations of the record zip under `backups/`,
 * where an older build also left whole-database copies, and the quarantine
 * keeps a whole damaged library beside the database.
 *
 * Expected behaviour: every one of those copies is marked excluded, at creation
 * and on the next open, while the latest record zip the platform backup carries
 * is never marked.
 */
import * as FileSystem from 'expo-file-system/legacy';

import { excludeExistingFromBackup, excludeFromBackup } from '@/shared/native/backupExclusion';
import { excludeSetAsideCopies } from '@/features/settings/lib/databaseSidecars';
import { captureQuarantineReport } from '@/features/settings/lib/quarantineReport';
import { excludeLocalBackupsFromDeviceBackup } from '@/features/settings/lib/autobackup/backends/localBackend';

jest.mock('@/shared/native/backupExclusion', () => ({
  excludeFromBackup: jest.fn(() => true),
  excludeExistingFromBackup: jest.fn(() => true),
}));

const mockTake = jest.fn();
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({ takeQuarantineReport: () => mockTake() }),
  getRouteDbPath: () => '/group/routes.db',
  isEngineReady: () => true,
}));

const fs = FileSystem as jest.Mocked<typeof FileSystem>;
const mark = excludeFromBackup as jest.Mock;
const markFile = excludeExistingFromBackup as jest.Mock;
const marked = () => mark.mock.calls.map(([path]: [string]) => path);
const markedFiles = () => markFile.mock.calls.map(([path]: [string]) => path);

const BESIDE_DB = [
  'routes.db',
  'routes.db-wal',
  'routes.db-shm',
  'routes.db.corrupt-1759219200',
  'routes.db.corrupt-1759219200-wal',
  'routes.db.corrupt-1759219200-shm',
  'routes.db.snapshot',
  'veloq_panic.log',
];

beforeEach(() => {
  jest.clearAllMocks();
  mockTake.mockReturnValue(null);
  fs.readDirectoryAsync.mockImplementation(async (uri: string) =>
    uri === 'file:///group/' ? BESIDE_DB : []
  );
  fs.getInfoAsync.mockImplementation(async (uri: string) => ({
    exists: false,
    uri,
    isDirectory: false,
  }));
});

describe('quarantined copies', () => {
  it('marks every quarantined generation and its pair, and nothing else', async () => {
    await excludeSetAsideCopies('/group/routes.db');

    expect(mark).not.toHaveBeenCalled();
    expect(markedFiles().sort()).toEqual([
      'file:///group/routes.db.corrupt-1759219200',
      'file:///group/routes.db.corrupt-1759219200-shm',
      'file:///group/routes.db.corrupt-1759219200-wal',
    ]);
  });

  it('marks a library the App Group move set aside, and its pair', async () => {
    fs.readDirectoryAsync.mockResolvedValue([
      'routes.db',
      'routes.db.displaced-20261001T080000',
      'routes.db.displaced-20261001T080000-wal',
    ]);

    await excludeSetAsideCopies('/group/routes.db');

    expect(markedFiles().sort()).toEqual([
      'file:///group/routes.db.displaced-20261001T080000',
      'file:///group/routes.db.displaced-20261001T080000-wal',
    ]);
  });

  it('marks nothing when no quarantine has happened', async () => {
    fs.readDirectoryAsync.mockResolvedValue(['routes.db', 'routes.db-wal']);

    await excludeSetAsideCopies('/group/routes.db');

    expect(markFile).not.toHaveBeenCalled();
  });

  it('settles quietly when the directory cannot be read', async () => {
    fs.readDirectoryAsync.mockRejectedValue(new Error('no such directory'));

    await expect(excludeSetAsideCopies('/group/routes.db')).resolves.toBeUndefined();
    expect(markFile).not.toHaveBeenCalled();
  });

  it('marks the copies after every open, including one an older build left', async () => {
    captureQuarantineReport();
    await new Promise(setImmediate);

    expect(markedFiles()).toContain('file:///group/routes.db.corrupt-1759219200');
  });

  it('marks the copies on the open that made them', async () => {
    mockTake.mockReturnValue({ history: 3 });

    captureQuarantineReport();
    await new Promise(setImmediate);

    expect(markedFiles()).toContain('file:///group/routes.db.corrupt-1759219200');
  });
  it('marks a copy an older build left in Documents, before the database moved', async () => {
    fs.readDirectoryAsync.mockImplementation(async (uri: string) =>
      uri === 'file:///docs/' ? ['routes.db.corrupt-1700000000', 'veloq-decisions.zip'] : []
    );

    captureQuarantineReport();
    await new Promise(setImmediate);

    expect(markedFiles()).toEqual(['file:///docs/routes.db.corrupt-1700000000']);
  });
});

describe('the local backup directory', () => {
  it('is marked on its own, for a directory an older build made', () => {
    excludeLocalBackupsFromDeviceBackup();

    expect(marked()).toEqual(['file:///docs/backups/']);
  });

  it('never marks the latest record zip the platform backup carries', async () => {
    excludeLocalBackupsFromDeviceBackup();
    await excludeSetAsideCopies('/docs/routes.db');

    expect(
      [...marked(), ...markedFiles()].some((path) => path.endsWith('veloq-decisions.zip'))
    ).toBe(false);
  });
});
