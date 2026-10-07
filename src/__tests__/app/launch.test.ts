/**
 * Scenario: a cold start with credentials in the keychain and a library on
 * disk. Every store's first read should come out of SQLite, which means the
 * engine has to be open before the stores are restored.
 *
 * Expected behaviour: the engine opens once auth resolves and before any
 * setting is read, no read falls through to AsyncStorage, the tile cache key
 * is read once, i18n still starts on the saved language, the launch is
 * marked step by step, and nothing probes the engine for a legacy purchaser.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system/legacy';
import * as format from '@/shared/format/format';
import { exportRecordBackup } from '@/features/settings/lib/backup';
import { inBackupSlot } from '@/features/settings/lib/backupSlot';
import { shareExistingFile } from '@/features/settings/lib/shareFile';

import { initializeApp } from '@/shared/app/launch';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useLanguageStore } from '@/shared/app/LanguageStore';
import { i18n } from '@/i18n';
import { initializeDebugStore } from '@/features/settings/stores/DebugStore';

type Call = { name: string; key?: string };

const calls: Call[] = [];
const stored = new Map<string, string>();

let mockEngineOpen = false;
let mockRouteDbPath = '/data/routes.db';
const mockFiles = new Set<string>();

const mockEngine = {
  get ready(): boolean {
    return mockEngineOpen;
  },
  initWithPath: jest.fn((path: string): boolean => {
    calls.push({ name: 'initWithPath', key: path });
    mockEngineOpen = true;
    return true;
  }),
  getSetting: jest.fn((key: string): string | undefined => {
    calls.push({ name: 'getSetting', key });
    return mockEngineOpen ? stored.get(key) : undefined;
  }),
  setSetting: jest.fn(),
  setSettings: jest.fn(),
  deleteSetting: jest.fn(),
  getActivityCount: jest.fn(() => {
    calls.push({ name: 'getActivityCount' });
    return 408;
  }),
  setSyncCredentials: jest.fn(),
  clearSyncCredentials: jest.fn(),
  getUnplacedBackupRecords: jest.fn(async () => {
    calls.push({ name: 'getUnplacedBackupRecords' });
    return [{ kind: 'import', name: null, reason: 'import_paused' }];
  }),
  restoreRecordJson: jest.fn(async () => {
    calls.push({ name: 'restoreRecordJson' });
    return { placed: 1, unplaced: 0, missingActivityIds: [] };
  }),
  syncNow: jest.fn(),
  runRecordBackup: jest.fn(async (path: string) => {
    mockFiles.add(`file://${path}`);
  }),
};

jest.mock('@/features/settings/stores/DebugStore', () => ({
  initializeDebugStore: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockEngine,
  getRouteDbPath: () => mockRouteDbPath,
  isEngineReady: () => mockEngineOpen,
  resolveRouteDbPath: () => {
    calls.push({ name: 'resolveRouteDbPath' });
    return Promise.resolve(mockRouteDbPath);
  },
}));

jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  documentDirectory: 'file:///data/documents/',
  cacheDirectory: 'file:///cache/',
  makeDirectoryAsync: jest.fn().mockResolvedValue(undefined),
  readDirectoryAsync: jest.fn(async (dir: string) => [
    ...new Set(
      [...mockFiles]
        .filter((uri) => uri.startsWith(dir))
        .map((uri) => uri.slice(dir.length).split('/')[0])
    ),
  ]),
  deleteAsync: jest.fn(async (uri: string) => {
    mockFiles.delete(uri);
  }),
}));

jest.mock('@/features/settings/lib/shareFile', () => ({
  shareExistingFile: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/native/backupExclusion', () => ({
  excludeFromBackup: jest.fn(() => true),
  excludeExistingFromBackup: jest.fn(() => true),
}));

const secureGet = SecureStore.getItemAsync as jest.Mock;

function keychain(values: Record<string, string>): void {
  secureGet.mockImplementation((key: string) => Promise.resolve(values[key] ?? null));
}

/** Every key the launch reads, as an install that has run 0.4.0 once holds them. */
const MIGRATED_KEYS = [
  'veloq-language-preference',
  'veloq-theme-preference',
  'veloq-primary-sport',
  'veloq-unit-preference',
  'veloq-route-settings',
  'veloq-heatmap-enabled',
  'veloq-map-routes-visible',
  'dashboard_summary_card',
  'veloq-debug-mode',
  'veloq-tile-cache',
  'veloq-whats-new-seen',
  'veloq-insights-fingerprint',
  'veloq-recording-preferences',
  'veloq-upload-permission',
  'veloq-notification-preferences',
  'veloq-notification-prompt-dismissed',
  'veloq-support-store',
  'veloq-track-fetch-dismissed',
];

function migratedLibrary(): void {
  for (const key of MIGRATED_KEYS) stored.set(key, '{}');
  stored.set('veloq-language-preference', 'de-DE');
}

beforeEach(() => {
  calls.length = 0;
  stored.clear();
  mockFiles.clear();
  mockEngineOpen = false;
  mockRouteDbPath = '/data/routes.db';
  jest.clearAllMocks();
  useAuthStore.setState({ isAuthenticated: false, isLoading: true, athleteId: null });
  useLanguageStore.setState({ language: null, isInitialized: false });
});

describe('initializeApp', () => {
  it('opens the engine after auth and before any setting is read', async () => {
    keychain({ intervals_api_key: 'key', intervals_athlete_id: 'i12345' });
    migratedLibrary();
    const getItem = jest.spyOn(AsyncStorage, 'getItem');

    await expect(initializeApp()).resolves.toBeNull();

    const open = calls.findIndex((c) => c.name === 'initWithPath');
    const firstRead = calls.findIndex((c) => c.name === 'getSetting');
    expect(open).toBeGreaterThanOrEqual(0);
    expect(firstRead).toBeGreaterThan(open);
    expect(mockEngine.initWithPath).toHaveBeenCalledTimes(1);
    expect(getItem).not.toHaveBeenCalled();
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it('settles where the database lives before opening it', async () => {
    keychain({ intervals_api_key: 'key', intervals_athlete_id: 'i12345' });
    migratedLibrary();

    await expect(initializeApp()).resolves.toBeNull();

    // The move is only a consistent snapshot of the database and its journal
    // while no connection is open, so it cannot follow initWithPath.
    const resolve = calls.findIndex((c) => c.name === 'resolveRouteDbPath');
    const open = calls.findIndex((c) => c.name === 'initWithPath');
    expect(resolve).toBeGreaterThanOrEqual(0);
    expect(open).toBeGreaterThan(resolve);
  });

  it('falls back to storage only for a key the engine does not hold', async () => {
    keychain({ intervals_api_key: 'key', intervals_athlete_id: 'i12345' });
    migratedLibrary();
    stored.delete('veloq-unit-preference');
    const getItem = jest.spyOn(AsyncStorage, 'getItem');

    await initializeApp();

    expect(getItem.mock.calls.map(([key]) => key)).toEqual(['veloq-unit-preference']);
  });

  it('starts i18n on the saved language when the read comes from the engine', async () => {
    keychain({ intervals_api_key: 'key', intervals_athlete_id: 'i12345' });
    stored.set('veloq-language-preference', 'fr');

    await initializeApp();

    expect(useLanguageStore.getState().language).toBe('fr');
    expect(i18n.language).toBe('fr');
  });

  it('reads the tile cache key once', async () => {
    keychain({ intervals_api_key: 'key', intervals_athlete_id: 'i12345' });
    stored.set('veloq-tile-cache', JSON.stringify({ cacheMode: 'aggressive', budgetMb: 200 }));

    await initializeApp();

    const tileReads = calls.filter((c) => c.name === 'getSetting' && c.key === 'veloq-tile-cache');
    expect(tileReads).toHaveLength(1);
  });

  it('leaves the engine closed and reads storage when there are no credentials', async () => {
    keychain({});
    const getItem = jest.spyOn(AsyncStorage, 'getItem');

    await expect(initializeApp()).resolves.toBeNull();

    expect(mockEngine.initWithPath).not.toHaveBeenCalled();
    expect(getItem).toHaveBeenCalled();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().isLoading).toBe(false);
  });

  it('never probes the engine for a legacy purchaser', async () => {
    keychain({ intervals_api_key: 'key', intervals_athlete_id: 'i12345' });

    await initializeApp();

    expect(mockEngine.getActivityCount).not.toHaveBeenCalled();
  });

  it('marks each launch step in order', async () => {
    keychain({ intervals_api_key: 'key', intervals_athlete_id: 'i12345' });
    const mark = jest.fn();
    Object.assign(performance, { mark });

    await initializeApp();

    const names = mark.mock.calls.map(([name]) => name).filter((n) => n.startsWith('launch:'));
    expect(names).toEqual(['launch:auth', 'launch:engine', 'launch:stores']);
  });

  it('hands the basemap tile store its directory under documents', async () => {
    keychain({ intervals_api_key: 'key', intervals_athlete_id: 'i12345' });

    await initializeApp();

    const basemap = jest.requireMock('veloqrs').basemapStore();
    expect(basemap.setPath).toHaveBeenCalledWith(expect.stringMatching(/basemap-tiles$/));
    const [path] = basemap.setPath.mock.calls[0] as [string];
    expect(path.startsWith('file://')).toBe(false);
  });

  it('hands the basemap store the tile limit once it has its directory', async () => {
    keychain({ intervals_api_key: 'key', intervals_athlete_id: 'i12345' });

    await initializeApp();

    const basemap = jest.requireMock('veloqrs').basemapStore();
    expect(basemap.setBudget).toHaveBeenCalledWith(50 * 1_000_000);
    expect(basemap.setPath.mock.invocationCallOrder[0]).toBeLessThan(
      basemap.setBudget.mock.invocationCallOrder[0]
    );
  });

  it('keeps the tile tree out of the device backup, on the directory the store was handed', async () => {
    keychain({ intervals_api_key: 'key', intervals_athlete_id: 'i12345' });
    const { excludeFromBackup } = jest.requireMock('@/shared/native/backupExclusion');

    await initializeApp();

    const basemap = jest.requireMock('veloqrs').basemapStore();
    const [path] = basemap.setPath.mock.calls[0] as [string];
    expect(excludeFromBackup).toHaveBeenCalledWith(path);
    expect(basemap.setPath.mock.invocationCallOrder[0]).toBeLessThan(
      excludeFromBackup.mock.invocationCallOrder[0]
    );
  });

  it('keeps the database and its sidecars out of the device backup, after the engine opened', async () => {
    keychain({ intervals_api_key: 'key', intervals_athlete_id: 'i12345' });
    mockRouteDbPath = '/group/app/routes.db';
    const { excludeExistingFromBackup } = jest.requireMock('@/shared/native/backupExclusion');

    await initializeApp();

    const marked = excludeExistingFromBackup.mock.calls.map(([path]: [string]) => path);
    expect(marked).toEqual(
      expect.arrayContaining([
        '/group/app/routes.db',
        '/group/app/routes.db-wal',
        '/group/app/routes.db-shm',
      ])
    );
    expect(mockEngine.initWithPath.mock.invocationCallOrder[0]).toBeLessThan(
      excludeExistingFromBackup.mock.invocationCallOrder[0]
    );
  });

  it('marks the database under Documents when there is no App Group', async () => {
    keychain({});
    mockRouteDbPath = '/data/documents/routes.db';
    const { excludeExistingFromBackup } = jest.requireMock('@/shared/native/backupExclusion');

    await initializeApp();

    const marked = excludeExistingFromBackup.mock.calls.map(([path]: [string]) => path);
    expect(marked).toEqual(
      expect.arrayContaining([
        '/data/documents/routes.db',
        '/data/documents/routes.db-wal',
        '/data/documents/routes.db-shm',
      ])
    );
  });

  it('never marks the record zip, which is the payload the device backup carries', async () => {
    keychain({ intervals_api_key: 'key', intervals_athlete_id: 'i12345' });
    const { excludeFromBackup, excludeExistingFromBackup } = jest.requireMock(
      '@/shared/native/backupExclusion'
    );

    await initializeApp();

    const marked = [...excludeFromBackup.mock.calls, ...excludeExistingFromBackup.mock.calls].map(
      ([path]: [string]) => path
    );
    expect(marked.filter((path: string) => path.includes('veloq-decisions'))).toEqual([]);
  });

  it('warns and carries on when the database mark does not take', async () => {
    keychain({ intervals_api_key: 'key', intervals_athlete_id: 'i12345' });
    const { excludeExistingFromBackup } = jest.requireMock('@/shared/native/backupExclusion');
    excludeExistingFromBackup.mockReturnValue(false);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(initializeApp()).resolves.toBeNull();

    expect(warn.mock.calls.some(([m]) => String(m).includes('routes.db'))).toBe(true);
    warn.mockRestore();
    excludeExistingFromBackup.mockReturnValue(true);
  });

  it('keeps the terrain previews out of the backup too, on every launch', async () => {
    keychain({ intervals_api_key: 'key', intervals_athlete_id: 'i12345' });
    const { excludeFromBackup } = jest.requireMock('@/shared/native/backupExclusion');

    await initializeApp();

    const marked = excludeFromBackup.mock.calls.map(([path]: [string]) => path);
    expect(marked).toContain('/data/documents/terrain_previews/');
  });

  it('keeps the local backup directory out of the backup, on every launch', async () => {
    keychain({ intervals_api_key: 'key', intervals_athlete_id: 'i12345' });
    const { excludeFromBackup } = jest.requireMock('@/shared/native/backupExclusion');

    await initializeApp();

    const marked = excludeFromBackup.mock.calls.map(([path]: [string]) => path);
    expect(marked).toContain('file:///data/documents/backups/');
  });

  it('marks the local backup directory with no credentials, since a backup outlives a sign-out', async () => {
    keychain({});
    const { excludeFromBackup } = jest.requireMock('@/shared/native/backupExclusion');

    await initializeApp();

    const marked = excludeFromBackup.mock.calls.map(([path]: [string]) => path);
    expect(marked).toContain('file:///data/documents/backups/');
  });

  it('does not mark a directory the store refused', async () => {
    keychain({ intervals_api_key: 'key', intervals_athlete_id: 'i12345' });
    const basemap = jest.requireMock('veloqrs').basemapStore();
    basemap.setPath.mockImplementationOnce(() => {
      throw new Error('store closed');
    });
    const { excludeFromBackup } = jest.requireMock('@/shared/native/backupExclusion');

    await initializeApp();

    // The terrain previews are excluded on every launch and have nothing to do
    // with the tile store, so the assertion is about the tile tree's path.
    const marked = excludeFromBackup.mock.calls.map(([path]: [string]) => path);
    expect(marked).not.toContain('/data/documents/basemap-tiles');
  });

  it('resolves to the failed area and never to the engine message', async () => {
    keychain({ intervals_api_key: 'key', intervals_athlete_id: 'i12345' });
    (initializeDebugStore as jest.Mock).mockRejectedValueOnce(new Error('debug store unreadable'));

    await expect(initializeApp()).resolves.toEqual(['other']);
  });

  it('resumes a paused record import once the engine is open', async () => {
    keychain({ intervals_api_key: 'key', intervals_athlete_id: 'i12345' });
    migratedLibrary();

    await initializeApp();
    await new Promise((resolve) => setImmediate(resolve));

    const open = calls.findIndex((c) => c.name === 'initWithPath');
    const resume = calls.findIndex((c) => c.name === 'restoreRecordJson');
    expect(mockEngine.restoreRecordJson).toHaveBeenCalledTimes(1);
    expect(resume).toBeGreaterThan(open);
  });

  it('starts no import resume while signed out', async () => {
    keychain({});

    await initializeApp();
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockEngine.restoreRecordJson).not.toHaveBeenCalled();
  });

  it('launches when the paused import cannot resume yet', async () => {
    keychain({ intervals_api_key: 'key', intervals_athlete_id: 'i12345' });
    migratedLibrary();
    mockEngine.restoreRecordJson.mockRejectedValueOnce(new Error('database or disk is full'));

    await expect(initializeApp()).resolves.toBeNull();
    await new Promise((resolve) => setImmediate(resolve));
    expect(mockEngine.restoreRecordJson).toHaveBeenCalledTimes(1);
  });
});

const staleBackups = [
  'file:///cache/exports/veloq-backup-2026-09-01.zip',
  'file:///cache/exports/veloq-record-abandoned.tmp',
  'file:///cache/veloq-backup-2026-09-01.veloqdb',
  'file:///cache/veloq-autobackup-123.veloqdb',
  'file:///data/documents/veloq-record-abandoned.tmp',
];
const retainedFiles = [
  'file:///data/documents/veloq-decisions.zip',
  'file:///data/documents/backups/veloq-backup-kept.zip',
  'file:///cache/restores/veloq-record-active.tmp',
  'file:///cache/DocumentPicker/veloq-backup-picked.zip',
  'file:///cache/exports/veloq-activities-2026-09-01.zip',
  'file:///cache/exports/River_Ride.gpx',
  'file:///cache/exports/veloq-crash-log.txt',
  'file:///cache/veloq-backup-unrelated.txt',
  'file:///cache/veloq-autobackup-unrelated.zip',
];

function seedBackupFiles() {
  for (const uri of [...staleBackups, ...retainedFiles]) mockFiles.add(uri);
}

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function finishBackupWork() {
  await inBackupSlot(async () => {});
}

describe('backup temporary files', () => {
  afterEach(() => jest.restoreAllMocks());

  it('sweeps only abandoned backup copies at launch, even when signed out', async () => {
    keychain({});
    seedBackupFiles();

    await initializeApp();
    await finishBackupWork();

    expect([...mockFiles].sort()).toEqual([...retainedFiles].sort());
  });

  it('keeps only the second export across different dates, until another sweep', async () => {
    jest
      .spyOn(format, 'formatLocalDate')
      .mockReturnValueOnce('2026-09-01')
      .mockReturnValueOnce('2026-09-02');
    await exportRecordBackup();
    expect(mockFiles.has('file:///cache/exports/veloq-backup-2026-09-01.zip')).toBe(true);

    await exportRecordBackup();

    expect([...mockFiles]).toEqual(['file:///cache/exports/veloq-backup-2026-09-02.zip']);
    expect(shareExistingFile).toHaveBeenLastCalledWith([...mockFiles][0], 'application/zip');
  });

  it('launches without waiting for a sweep queued behind an open share sheet', async () => {
    keychain({});
    const sharing = deferred();
    const opened = deferred();
    jest.mocked(shareExistingFile).mockImplementationOnce(() => {
      opened.resolve();
      return sharing.promise;
    });
    const exporting = exportRecordBackup();
    await opened.promise;
    const sharedUri = jest.mocked(shareExistingFile).mock.calls[0][0];
    try {
      await expect(initializeApp()).resolves.toBeNull();
      expect(mockFiles.has(sharedUri)).toBe(true);
    } finally {
      sharing.resolve();
      await exporting;
      await finishBackupWork();
    }
    expect(mockFiles.has(sharedUri)).toBe(false);
  });

  it('sweeps after a rejected share releases the slot', async () => {
    keychain({});
    jest.mocked(shareExistingFile).mockRejectedValueOnce(new Error('share unavailable'));
    await expect(exportRecordBackup()).rejects.toThrow('share unavailable');
    expect(mockFiles.size).toBe(1);

    await initializeApp();
    await finishBackupWork();

    expect(mockFiles.size).toBe(0);
  });

  it.each(['launch', 'export'])(
    'continues the %s sweep after one deletion rejects',
    async (trigger) => {
      keychain({});
      seedBackupFiles();
      const failure = new Error('file busy');
      jest.mocked(FileSystem.deleteAsync).mockImplementationOnce(async () => {
        throw failure;
      });
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

      if (trigger === 'launch') await expect(initializeApp()).resolves.toBeNull();
      else await expect(exportRecordBackup()).resolves.toBe('complete');
      await finishBackupWork();

      expect(staleBackups.filter((uri) => mockFiles.has(uri))).toHaveLength(1);
      expect(retainedFiles.every((uri) => mockFiles.has(uri))).toBe(true);
      expect(warn.mock.calls.some((args) => args.includes(failure))).toBe(true);
    }
  );

  it('continues other directories when listing one directory rejects', async () => {
    keychain({});
    seedBackupFiles();
    jest
      .mocked(FileSystem.readDirectoryAsync)
      .mockRejectedValueOnce(new Error('directory unreadable'));

    await expect(initializeApp()).resolves.toBeNull();
    await finishBackupWork();

    expect(mockFiles.has('file:///data/documents/veloq-record-abandoned.tmp')).toBe(false);
    expect(retainedFiles.every((uri) => mockFiles.has(uri))).toBe(true);
  });
});
