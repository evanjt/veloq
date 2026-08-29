/**
 * Scenario: a snapshot lands in the backup directory but its metadata never
 * does. Expected behaviour: nothing is left behind, because `listBackups`
 * cannot see a meta-less snapshot and retention only deletes what it lists.
 */
import * as FileSystem from 'expo-file-system/legacy';

import { localBackend } from '@/features/settings/lib/autobackup/backends/localBackend';

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///docs/',
  getInfoAsync: jest.fn(),
  makeDirectoryAsync: jest.fn(),
  readDirectoryAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
  writeAsStringAsync: jest.fn(),
  copyAsync: jest.fn(),
  deleteAsync: jest.fn(),
}));

const fs = FileSystem as jest.Mocked<typeof FileSystem>;
const DIR = 'file:///docs/backups/';

let files: Set<string>;

const metadata = {
  timestamp: '2026-08-29T10:00:00.000Z',
  sizeBytes: 1024,
  activityCount: 12,
};

beforeEach(() => {
  jest.clearAllMocks();
  files = new Set<string>();

  fs.getInfoAsync.mockImplementation(async (uri: string) => ({
    exists: uri === DIR || files.has(uri),
    uri,
  }));
  fs.readDirectoryAsync.mockImplementation(async () =>
    [...files].filter((f) => f.startsWith(DIR)).map((f) => f.slice(DIR.length))
  );
  fs.copyAsync.mockImplementation(async ({ to }) => {
    files.add(to);
  });
  fs.writeAsStringAsync.mockImplementation(async (uri: string) => {
    files.add(uri);
  });
  fs.deleteAsync.mockImplementation(async (uri: string) => {
    files.delete(uri);
  });
});

const snapshots = () => [...files].filter((f) => f.endsWith('.veloqdb'));

describe('local backup orphans', () => {
  it('leaves no snapshot behind when the metadata write fails', async () => {
    fs.writeAsStringAsync.mockRejectedValueOnce(new Error('disk full'));

    await expect(localBackend.upload('file:///tmp/snap.veloqdb', metadata)).rejects.toThrow(
      'disk full'
    );

    expect(snapshots()).toHaveLength(0);
  });

  it('reclaims a snapshot a previous run left with no metadata', async () => {
    files.add(`${DIR}veloq-orphan.veloqdb`);

    await localBackend.upload('file:///tmp/snap.veloqdb', metadata);

    expect(snapshots()).toEqual([`${DIR}veloq-2026-08-29T10-00-00-000Z.veloqdb`]);
  });

  it('keeps snapshots that do have metadata', async () => {
    files.add(`${DIR}veloq-keep.veloqdb`);
    files.add(`${DIR}veloq-keep.veloqdb.meta.json`);

    await localBackend.upload('file:///tmp/snap.veloqdb', metadata);

    expect(snapshots()).toContain(`${DIR}veloq-keep.veloqdb`);
  });

  it('lists every snapshot it keeps, so retention can reclaim them', async () => {
    fs.readAsStringAsync.mockImplementation(async (uri: string) =>
      JSON.stringify({ id: uri.slice(DIR.length).replace('.meta.json', ''), ...metadata })
    );

    await localBackend.upload('file:///tmp/snap.veloqdb', metadata);

    const listed = await localBackend.listBackups();
    expect(listed.map((e) => `${DIR}${e.id}`).sort()).toEqual(snapshots().sort());
  });
});
