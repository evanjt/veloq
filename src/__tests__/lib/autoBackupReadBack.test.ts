/**
 * Scenario: a carrier says it took the zip, but what it holds is truncated,
 * altered or cannot be fetched again.
 *
 * Expected behaviour: a run reads every carrier's copy back and compares it
 * with the zip it sent before stamping the destination. A copy that differs or
 * cannot be read back is a failed write of kind `unverified`: the destination
 * keeps its previous stamp, the carrier stays owed so the next trigger sends
 * the zip again, and the temporary copy is deleted either way.
 */

import {
  getBackupFailures,
  getDestinationLastBackup,
  getLastBackupTimestamp,
  performBackup,
  type BackupBackend,
  type BackupEntry,
} from '@/features/settings/lib/autobackup';

const MOCK_ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8]);
const RUN_AT = Date.parse('2026-05-04T06:30:00Z');

const mockSettings = new Map<string, string>();
/** Every file on the device by uri, the record zip among them. */
const mockFiles = new Map<string, Uint8Array>();
const mockCarriers: BackupBackend[] = [];

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    getSetting: (key: string) => mockSettings.get(key),
    setSetting: (key: string, value: string) => mockSettings.set(key, value),
    deleteSetting: (key: string) => mockSettings.delete(key),
    engineInstall: () => 1,
    runRecordBackup: async (path: string) => {
      mockFiles.set(`file://${path}`, MOCK_ZIP);
    },
  }),
}));

jest.mock('@/features/settings/lib/autobackup/backends/carriers', () => ({
  get backupCarriers() {
    return mockCarriers;
  },
}));

jest.mock('@/features/settings/lib/autobackup/webdavConfig', () => ({
  ...jest.requireActual('@/features/settings/lib/autobackup/webdavConfig'),
  getWebdavConfig: () => ({
    url: 'https://dav.example.org/files/rower',
    username: 'r',
    password: 'p',
  }),
}));

jest.mock('@/shared/native/backupFolder', () => ({
  ...jest.requireActual('@/shared/native/backupFolder'),
  heldBackupFolder: () => 'content://tree/primary%3ARegatta',
}));

jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  documentDirectory: 'file:///docs/',
  cacheDirectory: 'file:///cache/',
  makeDirectoryAsync: async () => undefined,
  getInfoAsync: async (uri: string) => {
    const bytes = mockFiles.get(uri);
    return bytes ? { exists: true, size: bytes.length } : { exists: false };
  },
  deleteAsync: async (uri: string) => {
    mockFiles.delete(uri);
  },
}));

jest.mock('expo-file-system', () => ({
  File: class {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    async bytes(): Promise<Uint8Array> {
      const bytes = mockFiles.get(this.uri);
      if (!bytes) throw new Error(`missing ${this.uri}`);
      return bytes;
    }
  },
}));

jest.mock('expo-crypto', () => ({
  ...jest.requireActual('expo-crypto'),
  digest: async (_algorithm: string, data: Uint8Array) => {
    const hash = jest
      .requireActual<typeof import('crypto')>('crypto')
      .createHash('sha256')
      .update(data)
      .digest();
    return hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength);
  },
}));

jest.mock('expo-network', () => ({
  ...jest.requireActual('expo-network'),
  getNetworkStateAsync: async () => ({ isConnected: true, isInternetReachable: true }),
}));

/** How a carrier answers when the run asks for its copy back. */
type ReadBack = 'faithful' | 'altered' | 'truncated' | 'throws';

interface StubCarrier extends BackupBackend {
  readBack: ReadBack;
  /** What the carrier holds, by the id `upload` returned. */
  held: Map<string, Uint8Array>;
  downloads: { id: string; dest: string }[];
}

function stubCarrier(id: 'webdav' | 'folder'): StubCarrier {
  const carrier: StubCarrier = {
    id,
    name: id,
    isRemote: false,
    readBack: 'faithful',
    held: new Map(),
    downloads: [],
    isAvailable: async () => true,
    listBackups: async () => [],
    async upload(localPath: string, entry: Omit<BackupEntry, 'id'>) {
      const backupId = `veloq-${entry.timestamp}.zip`;
      carrier.held.set(backupId, mockFiles.get(localPath)!);
      return backupId;
    },
    async download(backupId: string, destPath: string) {
      carrier.downloads.push({ id: backupId, dest: destPath });
      const held = carrier.held.get(backupId);
      if (!held || carrier.readBack === 'throws') throw new Error('read refused');
      if (carrier.readBack === 'altered') {
        const altered = held.slice();
        altered[altered.length - 1] ^= 0xff;
        mockFiles.set(destPath, altered);
      } else if (carrier.readBack === 'truncated') {
        mockFiles.set(destPath, held.slice(0, held.length - 3));
      } else {
        mockFiles.set(destPath, held);
      }
    },
    delete: async () => {},
  };
  return carrier;
}

function owedCarriers(): string[] {
  const raw = mockSettings.get('__backup_owed_carriers');
  return raw ? (JSON.parse(raw) as string[]) : [];
}

/** Files left in the cache, where the read-back copies are taken. */
function cacheFiles(): string[] {
  return [...mockFiles.keys()].filter((uri) => uri.startsWith('file:///cache/'));
}

let webdav: StubCarrier;
let folder: StubCarrier;

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(RUN_AT);
  mockSettings.clear();
  mockFiles.clear();
  mockSettings.set('__auto_backup_enabled', '1');
  webdav = stubCarrier('webdav');
  folder = stubCarrier('folder');
  mockCarriers.length = 0;
  mockCarriers.push(webdav, folder);
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('stamps a carrier whose copy reads back the same, after fetching the id it wrote', async () => {
  const result = await performBackup(true);

  expect(result.carriers).toEqual({ webdav: { status: 'written' }, folder: { status: 'written' } });
  expect(webdav.downloads.map((d) => d.id)).toEqual([...webdav.held.keys()]);
  expect(folder.downloads.map((d) => d.id)).toEqual([...folder.held.keys()]);
  expect(getDestinationLastBackup('webdav')).toBe(RUN_AT);
  expect(getDestinationLastBackup('folder')).toBe(RUN_AT);
  expect(getLastBackupTimestamp()).toBe(RUN_AT);
  expect(owedCarriers()).toEqual([]);
  expect(cacheFiles()).toEqual([]);
});

it.each<ReadBack>(['altered', 'truncated', 'throws'])(
  'reports a copy that reads back %s as unverified, leaves it unstamped and owed',
  async (readBack) => {
    webdav.readBack = readBack;

    const result = await performBackup(true);

    expect(result.carriers.webdav).toEqual({ status: 'failed', kind: 'unverified' });
    expect(result.carriers.folder).toEqual({ status: 'written' });
    expect(getDestinationLastBackup('webdav')).toBeNull();
    expect(getDestinationLastBackup('folder')).toBe(RUN_AT);
    expect(owedCarriers()).toEqual(['webdav']);
    // Owed, so the run is not the day's backup and the next trigger retries.
    expect(getLastBackupTimestamp()).toBeNull();
    // It passes on its own, so nothing stands on the settings screen.
    expect(getBackupFailures()).toEqual({});
    expect(cacheFiles()).toEqual([]);
  }
);

it('sends an owed copy again on the next trigger and stamps it once it reads back the same', async () => {
  await performBackup(true);
  const failedAt = RUN_AT + 60_000;
  (Date.now as jest.Mock).mockReturnValue(failedAt);
  webdav.readBack = 'altered';
  await performBackup(true);
  expect(owedCarriers()).toEqual(['webdav']);

  const later = RUN_AT + 120_000;
  (Date.now as jest.Mock).mockReturnValue(later);
  webdav.readBack = 'faithful';
  const retry = await performBackup();

  expect(retry.carriers).toEqual({ webdav: { status: 'written' } });
  expect(getDestinationLastBackup('webdav')).toBe(later);
  expect(getDestinationLastBackup('folder')).toBe(failedAt);
  expect(owedCarriers()).toEqual([]);
  expect(getLastBackupTimestamp()).toBe(later);
});

it('keeps a carrier on its previous stamp when a later copy does not read back', async () => {
  await performBackup(true);
  const later = RUN_AT + 86_400_000;
  (Date.now as jest.Mock).mockReturnValue(later);
  folder.readBack = 'truncated';

  await performBackup(true);

  expect(getDestinationLastBackup('folder')).toBe(RUN_AT);
  expect(getDestinationLastBackup('webdav')).toBe(later);
});
