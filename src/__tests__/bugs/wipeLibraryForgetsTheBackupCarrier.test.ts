/**
 * Scenario: athlete A, signed in with OAuth and notifications on, set up WebDAV
 * with auto-backup on, kept local backups (record zips and the whole-database
 * `.veloqdb` copies older builds wrote), shared a backup, exported activities,
 * GPX and a crash log through the share sheet, imported a backup through the
 * document picker, was sent a notification with a route picture, and left a
 * key queued offline. A derived-data clear was killed part way, leaving its
 * rollback copy of the library beside the database, and a restore was killed
 * part way, leaving its copy in the cache, and a launch moved a corrupt database
 * aside as a quarantined copy. The library then goes to athlete B through any of the
 * three wipes, Sign out and delete data, Clear & Sync, or the launch wipe, and
 * all three run `wipeLibrary`.
 *
 * Expected behaviour: nothing of A's survives it. B's first sync would
 * otherwise upload B's records to A's server under A's password, the login
 * screen would offer A's newest local backup to B, A's tracks would sit in the
 * cache, A's rides would keep pushing to this phone, and A's ride names, PRs
 * and route pictures would stay in the tray.
 *
 * `DEVICE_WRITES` below is every place the app or the engine writes on the
 * device, each wiped, kept for a stated reason, or owed. Every file
 * `scripts/lint-device-writes.mjs` counts a write in has to be named by an
 * entry, so a new write fails here until someone says what the wipe does
 * with it, and every wiped entry is seeded and has to be gone after the wipe.
 */

import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';
import * as FileSystem from 'expo-file-system/legacy';

import { wipeLibrary } from '@/shared/storage';
import { getWebdavConfig, setWebdavConfig } from '@/features/settings/lib/autobackup/webdavConfig';
import {
  getLastBackupFailure,
  getLastBackupTimestamp,
  isAutoBackupEnabled,
} from '@/features/settings/lib/autobackup/autoBackup';
import { localBackend } from '@/features/settings/lib/autobackup/backends/localBackend';
import { readPendingApiKey, savePendingApiKey } from '@/features/auth/lib/pendingSignIn';
import {
  resolvePendingUnregisterAthleteId,
  useNotificationPreferences,
} from '@/features/settings/stores/NotificationPreferencesStore';
import { unregisterPushToken } from '@/features/settings/lib/pushTokenRegistration';
import { shareFile } from '@/features/settings/lib/shareFile';
import {
  exportRecordBackup,
  restoreDatabaseBackup,
  restoreRecordBackup,
} from '@/features/settings/lib/backup';
import { useAuthStore } from '@/shared/app/AuthStore';
import { writeWidgetSnapshot } from '@/features/home/lib/widgetBridge';
import {
  getCameraOverride,
  setCameraOverride,
} from '@/features/maps/lib/storage/terrainCameraOverrides';
import { reportTrackFetchRun, useTrackFetchNotice } from '@/features/routes/lib/trackFetchNotice';
import { getCrashLog, recordCrash } from '@/shared/debug/crashLog';
import { getMapCameraState, saveMapCameraState } from '@/features/maps/lib/storage/mapCameraState';
import { useSensorStore } from '@/features/sensors/store';
import { useUploadPermissionStore } from '@/features/recording/stores/UploadPermissionStore';
import {
  MapPreferencesProvider,
  useMapPreferences,
} from '@/features/maps/stores/MapPreferencesContext';

import deviceWriteSites from '../__shared__/deviceWriteSites.json';

/** Every file on the device, by uri. A directory is every uri under its prefix. */
const mockFiles = new Map<string, string>();
const mockKeychain = new Map<string, string>();
const mockEngineSettings = new Map<string, string>();
const mockAsyncStorage = new Map<string, string>();
/** What `setSetting` writes, which is AsyncStorage and the settings table at once. */
const mockSettings = new Map<string, string>();
/** The tray and the schedule, by notification identifier. */
const mockTray = new Set<string>();
const mockScheduled = new Set<string>();
/** WorkManager's queued activity pushes, by unique work name. */
const mockPushJobs = new Set<string>();

jest.mock('expo-file-system/legacy', () => {
  const under = (dir: string) => [...mockFiles.keys()].filter((uri) => uri.startsWith(dir));
  return {
    ...jest.requireActual('expo-file-system/legacy'),
    documentDirectory: 'file:///docs/',
    cacheDirectory: 'file:///cache/',
    getInfoAsync: jest.fn(async (uri: string) => {
      const isDirectory = uri.endsWith('/') && under(uri).length > 0;
      return { exists: mockFiles.has(uri) || isDirectory, isDirectory };
    }),
    makeDirectoryAsync: jest.fn(async () => undefined),
    copyAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
      const content = mockFiles.get(from);
      if (content === undefined) throw new Error(`No such file: ${from}`);
      mockFiles.set(to, content);
    }),
    moveAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
      const content = mockFiles.get(from);
      if (content === undefined) throw new Error('ENOENT');
      mockFiles.set(to, content);
      mockFiles.delete(from);
    }),
    writeAsStringAsync: jest.fn(async (uri: string, content: string) => {
      mockFiles.set(uri, content);
    }),
    readAsStringAsync: jest.fn(async (uri: string) => {
      const content = mockFiles.get(uri);
      if (content === undefined) throw new Error(`No such file: ${uri}`);
      return content;
    }),
    readDirectoryAsync: jest.fn(async (dir: string) => [
      ...new Set(under(dir).map((uri) => uri.slice(dir.length).split('/')[0])),
    ]),
    // A directory goes whole, named with its trailing slash or without.
    deleteAsync: jest.fn(async (uri: string) => {
      mockFiles.delete(uri);
      for (const child of under(uri.endsWith('/') ? uri : `${uri}/`)) mockFiles.delete(child);
    }),
  };
});

jest.mock('expo-notifications', () => ({
  ...jest.requireActual('expo-notifications'),
  dismissAllNotificationsAsync: jest.fn(async () => mockTray.clear()),
  cancelAllScheduledNotificationsAsync: jest.fn(async () => mockScheduled.clear()),
}));

jest.mock('expo-sharing', () => ({
  ...jest.requireActual('expo-sharing'),
  shareAsync: jest.fn(async () => undefined),
}));

jest.mock('@/features/settings/lib/pushTokenRegistration', () => ({
  unregisterPushToken: jest.fn(async () => true),
  registerPushToken: jest.fn(async () => true),
}));

/** The Rust tile store's clear, which empties the tree the way the real one does. */
const mockClearTiles = jest.fn((): number => {
  for (const uri of [...mockFiles.keys()]) {
    if (uri.startsWith('file:///docs/basemap-tiles/')) mockFiles.delete(uri);
  }
  return 1;
});
jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    basemapStore: () => ({ clearTiles: () => mockClearTiles() }),
  })
);

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockEngine,
  getRouteDbPath: () => mockRouteDbPath(),
  getNativeModule: () => mockNativeModule,
  isEngineReady: () => true,
}));

/** Documents until a launch moves the database into the App Group container. */
const mockRouteDbPath = jest.fn(() => '/docs/routes.db');

/** The legacy reader, which writes the converted record zip where it is asked. */
const mockNativeModule = {
  convertLegacyDatabaseToRecordBackup: jest.fn(async (_source: string, record: string) => {
    mockFiles.set(`file://${record}`, 'zip');
  }),
};

jest.mock('@/shared/storage/settingsStorage', () => ({
  getSetting: jest.fn(async (key: string) => mockSettings.get(key) ?? null),
  setSetting: jest.fn(async (key: string, value: string) => {
    mockSettings.set(key, value);
  }),
  removeSetting: jest.fn(async (key: string) => {
    mockSettings.delete(key);
    mockAsyncStorage.delete(key);
  }),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockAsyncStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockAsyncStorage.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      mockAsyncStorage.delete(key);
    }),
  },
}));

/**
 * The home-screen widget's native module: the snapshot file it writes into the
 * App Group or `filesDir`, and the launcher shortcuts. The bridge asks for the
 * module as it loads, so it is installed where expo looks for native modules
 * just before the bridge is first required.
 */
jest.mock('@/features/home/lib/widgetBridge', () => {
  const widget = {
    snapshot: null as string | null,
    shortcuts: [] as unknown[],
    writeSnapshot: (json: string) => {
      widget.snapshot = json;
    },
    clearSnapshot: () => {
      widget.snapshot = null;
    },
    reloadWidgets: () => undefined,
    publishRecordShortcuts: (shortcuts: unknown[]) => {
      widget.shortcuts = shortcuts;
    },
  };
  const expo = (globalThis as unknown as { expo: { modules: Record<string, unknown> } }).expo;
  expo.modules = { ...expo.modules, VeloqWidget: widget };
  return { ...jest.requireActual('@/features/home/lib/widgetBridge'), mockWidget: widget };
});

const mockWidget = (
  jest.requireMock('@/features/home/lib/widgetBridge') as {
    mockWidget: { snapshot: string | null; shortcuts: unknown[] };
  }
).mockWidget;

/** The engine's own wipe, which keeps the settings table's carrier keys as Rust's `clear` does. */
const mockEngine = {
  clear: jest.fn(async () => undefined),
  getSetting: (key: string) => mockEngineSettings.get(key) ?? null,
  setSetting: (key: string, value: string) => mockEngineSettings.set(key, value),
  deleteSetting: (key: string) => mockEngineSettings.delete(key),
  clearSyncCredentials: jest.fn(),
  runRecordBackup: jest.fn(async (path: string) => {
    mockFiles.set(`file://${path}`, 'zip');
  }),
  getActivityCount: () => 0,
  restoreRecordZip: jest.fn(async () => ({ unplaced: 0, missingActivityIds: [] as string[] })),
};

/** The Android module that cancels the queued pushes, looked up when the wipe runs. */
(globalThis as unknown as { expo: { modules: Record<string, unknown> } }).expo.modules.VeloqPush = {
  cancelQueuedActivityPushes: () => mockPushJobs.clear(),
};

/** The image loader's disk cache, which holds the profile photo it fetched. */
let mockImageDiskCache: string[] = [];

/** The native module that clears the image loader's disk cache, looked up when the wipe runs. */
(globalThis as unknown as { expo: { modules: Record<string, unknown> } }).expo.modules.VeloqMemory =
  {
    clearImageDiskCache: () => {
      mockImageDiskCache = [];
    },
  };

const ATHLETE_A = 'i12345';

const BACKUP_FILES = [
  'file:///docs/backups/veloq-2026-09-30T08-00-00-000Z.zip',
  'file:///docs/backups/veloq-2026-09-30T08-00-00-000Z.zip.meta.json',
  'file:///docs/backups/veloq-2026-03-01T08-00-00-000Z.veloqdb',
  'file:///docs/backups/veloq-2026-03-01T08-00-00-000Z.veloqdb.meta.json',
  'file:///cache/veloq-backup-2026-09-30.zip',
  'file:///cache/veloq-autobackup-1759219200000.veloqdb',
  'file:///cache/restore-temp.veloqdb',
  'file:///cache/restore-selected-1759219200000.zip',
  'file:///cache/restore-record-1759219200000-1.zip',
  'file:///cache/restore-legacy-1759219200000-2.veloqdb',
  'file:///cache/restore-legacy-1759219200000-2.zip',
  'file:///cache/restores/restore-temp.zip',
  'file:///cache/restores/restore-selected-1759219200000.veloqdb',
  'file:///cache/restores/restore-record-1759219200000-1.zip',
  'file:///cache/restores/restore-legacy-1759219200000-2.veloqdb',
];

/** The rollback copy a killed derived-data clear leaves beside the database, with its pair. */
const CLEAR_SNAPSHOT_FILES = [
  'file:///docs/routes.db.clear-bak',
  'file:///docs/routes.db.clear-bak-wal',
  'file:///docs/routes.db.clear-bak-shm',
];

/**
 * The quarantined generation a corrupt database leaves beside itself at
 * launch, with its pair. It is a whole copy of the library the salvage can
 * still read.
 */
const QUARANTINE_FILES = [
  'file:///docs/routes.db.corrupt-1759219200',
  'file:///docs/routes.db.corrupt-1759219200-wal',
  'file:///docs/routes.db.corrupt-1759219200-shm',
];

/**
 * What the share sheet, the activity export, the notification pictures and the
 * document picker leave in the cache, at the names this build writes and at
 * the cache-root names older builds wrote.
 */
const CACHE_FILES = [
  'file:///cache/exports/veloq-activities-2026-10-01.zip',
  'file:///cache/exports/veloq-activities-2026-10-01.geojson',
  'file:///cache/veloq-activities-2026-09-30.zip',
  'file:///cache/veloq-activities-2026-09-30.geojson',
  'file:///cache/Morning_Ride.gpx',
  'file:///cache/veloq-crash-log.txt',
  'file:///cache/notification_routes/a1.png',
  'file:///cache/DocumentPicker/0f6c2a1e-1b7d-4c55-9a43-2f0d8e1c9b10.veloqdb',
  'file:///cache/DocumentPicker/7a1d9b2c-55e0-4f3e-8d21-9c4b0e6a1f22.zip',
];

beforeEach(() => {
  mockFiles.clear();
  mockKeychain.clear();
  mockEngineSettings.clear();
  mockAsyncStorage.clear();
  mockSettings.clear();
  mockWidget.snapshot = null;
  mockWidget.shortcuts = [];
  mockTray.clear();
  mockScheduled.clear();
  mockPushJobs.clear();
  mockImageDiskCache = [];
  jest.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => {
    mockKeychain.set(key, value);
  });
  jest
    .mocked(SecureStore.getItemAsync)
    .mockImplementation(async (key) => mockKeychain.get(key) ?? null);
  jest.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => {
    mockKeychain.delete(key);
  });
});

afterAll(() => {
  jest.mocked(SecureStore.setItemAsync).mockResolvedValue(undefined);
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue(null);
  jest.mocked(SecureStore.deleteItemAsync).mockResolvedValue(undefined);
});

async function seedAthleteA() {
  await setWebdavConfig('https://dav.example.com/veloq', 'athlete-a', 'secret-a');
  await savePendingApiKey('queued-key-a');
  mockEngineSettings.set('__backup_backend', 'webdav');
  mockEngineSettings.set('__auto_backup_enabled', '1');
  mockEngineSettings.set('__last_auto_backup', String(Date.parse('2026-09-30T08:00:00Z')));
  mockEngineSettings.set(
    '__last_backup_failure',
    JSON.stringify({ kind: 'auth', status: 401, at: Date.parse('2026-09-29T08:00:00Z') })
  );
  useAuthStore.setState({
    athleteId: ATHLETE_A,
    accessToken: 'oauth-token-a',
    authMethod: 'oauth',
    isAuthenticated: true,
    isDemoMode: false,
  });
  useNotificationPreferences.setState({
    enabled: true,
    privacyAccepted: true,
    pendingUnregister: false,
    pendingUnregisterAthleteId: null,
  });
  for (const uri of [
    ...BACKUP_FILES,
    ...CACHE_FILES,
    ...CLEAR_SNAPSHOT_FILES,
    ...QUARANTINE_FILES,
  ]) {
    mockFiles.set(uri, '{}');
  }
  mockTray.add('activity-i999');
  mockTray.add('server-push-i999');
  mockScheduled.add('activity-i1000');
  await shareFile({
    content: '<gpx/>',
    filename: 'Evening_Ride.gpx',
    mimeType: 'application/gpx+xml',
  });
  await shareFile({ content: 'crash', filename: 'veloq-crash-log.txt', mimeType: 'text/plain' });
  await exportRecordBackup();
  for (const uri of BACKUP_FILES.filter((u) => u.endsWith('.meta.json'))) {
    mockFiles.set(uri, JSON.stringify({ id: uri.split('/').pop(), timestamp: '2026-09-30' }));
  }
}

describe('the wipe every hand-off takes', () => {
  it("leaves nothing of the previous athlete's backup carrier", async () => {
    await seedAthleteA();
    expect(await localBackend.listBackups()).toHaveLength(2);

    await wipeLibrary();

    expect(getWebdavConfig()).toBeNull();
    expect([...mockKeychain.keys()]).toEqual([]);
    expect(await readPendingApiKey()).toBeNull();

    expect(isAutoBackupEnabled()).toBe(false);
    expect(getLastBackupTimestamp()).toBeNull();
    expect(getLastBackupFailure()).toBeNull();
    expect([...mockEngineSettings.keys()]).toEqual([]);

    const preferences = useNotificationPreferences.getState();
    expect(preferences.enabled).toBe(false);
    expect(preferences.privacyAccepted).toBe(false);

    expect(BACKUP_FILES.filter((uri) => mockFiles.has(uri))).toEqual([]);
    expect(await localBackend.listBackups()).toEqual([]);
  });

  it('leaves nothing of the previous athlete in the cache', async () => {
    await seedAthleteA();
    const cached = () => [...mockFiles.keys()].filter((uri) => uri.startsWith('file:///cache/'));
    expect(cached().length).toBeGreaterThan(CACHE_FILES.length);

    await wipeLibrary();

    expect(cached()).toEqual([]);
  });

  it("leaves no rollback copy of the previous athlete's library beside the database", async () => {
    await seedAthleteA();

    await wipeLibrary();

    expect(CLEAR_SNAPSHOT_FILES.filter((uri) => mockFiles.has(uri))).toEqual([]);
  });

  it('takes the rollback copy an older build left in Documents before the database moved', async () => {
    await seedAthleteA();
    mockRouteDbPath.mockReturnValue('/group/routes.db');
    mockFiles.set('file:///group/routes.db.clear-bak', '{}');

    try {
      await wipeLibrary();
    } finally {
      mockRouteDbPath.mockReturnValue('/docs/routes.db');
    }

    expect(
      [...CLEAR_SNAPSHOT_FILES, 'file:///group/routes.db.clear-bak'].filter((uri) =>
        mockFiles.has(uri)
      )
    ).toEqual([]);
  });

  it("leaves no quarantined copy of the previous athlete's library beside the database", async () => {
    await seedAthleteA();
    mockFiles.set('file:///docs/routes.db', 'live');
    mockFiles.set('file:///docs/routes.db-wal', 'live');
    mockFiles.set('file:///docs/notroutes.db.corrupt-1', 'other');

    await wipeLibrary();

    expect(QUARANTINE_FILES.filter((uri) => mockFiles.has(uri))).toEqual([]);
    expect(mockFiles.has('file:///docs/routes.db')).toBe(true);
    expect(mockFiles.has('file:///docs/routes.db-wal')).toBe(true);
    expect(mockFiles.has('file:///docs/notroutes.db.corrupt-1')).toBe(true);
  });

  it('takes the quarantined copy an older build left in Documents before the database moved', async () => {
    await seedAthleteA();
    mockRouteDbPath.mockReturnValue('/group/routes.db');
    mockFiles.set('file:///group/routes.db.corrupt-1759305600', '{}');
    mockFiles.set('file:///group/routes.db.corrupt-1759305600-wal', '{}');

    try {
      await wipeLibrary();
    } finally {
      mockRouteDbPath.mockReturnValue('/docs/routes.db');
    }

    expect(
      [
        ...QUARANTINE_FILES,
        'file:///group/routes.db.corrupt-1759305600',
        'file:///group/routes.db.corrupt-1759305600-wal',
      ].filter((uri) => mockFiles.has(uri))
    ).toEqual([]);
  });

  it('takes a library the move into the App Group set aside beside the database', async () => {
    await seedAthleteA();
    mockRouteDbPath.mockReturnValue('/group/routes.db');
    mockFiles.set('file:///group/routes.db', 'live');
    mockFiles.set('file:///group/routes.db.displaced-20261001T080000000Z', '{}');
    mockFiles.set('file:///group/routes.db.displaced-20261001T080000000Z-wal', '{}');
    mockFiles.set('file:///group/notroutes.db.displaced-1', 'other');

    try {
      await wipeLibrary();
    } finally {
      mockRouteDbPath.mockReturnValue('/docs/routes.db');
    }

    expect(
      [
        'file:///group/routes.db.displaced-20261001T080000000Z',
        'file:///group/routes.db.displaced-20261001T080000000Z-wal',
      ].filter((uri) => mockFiles.has(uri))
    ).toEqual([]);
    expect(mockFiles.has('file:///group/routes.db')).toBe(true);
    expect(mockFiles.has('file:///group/notroutes.db.displaced-1')).toBe(true);
  });

  it('still wipes the library when an older build left no Documents directory to list', async () => {
    await seedAthleteA();
    const list = jest.mocked(FileSystem.readDirectoryAsync);
    const real = list.getMockImplementation()!;
    list.mockImplementation(async (dir: string) => {
      if (dir === 'file:///docs/') throw new Error('No such directory');
      return real(dir);
    });

    try {
      await wipeLibrary();
    } finally {
      list.mockImplementation(real);
    }

    expect(BACKUP_FILES.filter((uri) => mockFiles.has(uri))).toEqual([]);
  });

  it('takes the panic log beside the moved database and the one an older build left in Documents', async () => {
    await seedAthleteA();
    mockRouteDbPath.mockReturnValue('/group/routes.db');
    mockFiles.set('file:///group/veloq_panic.log', 'panic at i999');
    mockFiles.set('file:///docs/veloq_panic.log', 'panic at i998');
    mockFiles.set('file:///group/other_panic.log', 'not ours');

    try {
      await wipeLibrary();
    } finally {
      mockRouteDbPath.mockReturnValue('/docs/routes.db');
    }

    expect(mockFiles.has('file:///group/veloq_panic.log')).toBe(false);
    expect(mockFiles.has('file:///docs/veloq_panic.log')).toBe(false);
    expect(mockFiles.has('file:///group/other_panic.log')).toBe(true);
  });

  it('still wipes the library where no native module can cancel the queued pushes', async () => {
    await seedAthleteA();
    const modules = (globalThis as unknown as { expo: { modules: Record<string, unknown> } }).expo
      .modules;
    const pushModule = modules.VeloqPush;
    delete modules.VeloqPush;

    try {
      await wipeLibrary();
    } finally {
      modules.VeloqPush = pushModule;
    }

    expect(BACKUP_FILES.filter((uri) => mockFiles.has(uri))).toEqual([]);
  });

  it("leaves none of the previous athlete's notifications in the tray or the schedule", async () => {
    await seedAthleteA();

    await wipeLibrary();

    expect([...mockTray]).toEqual([]);
    expect([...mockScheduled]).toEqual([]);
  });

  it('clears the tray once the push token is gone, so no push lands after it', async () => {
    await seedAthleteA();
    const order: string[] = [];
    jest.mocked(unregisterPushToken).mockImplementationOnce(async () => {
      await Promise.resolve();
      order.push('unregistered');
      return true;
    });
    jest.mocked(Notifications.dismissAllNotificationsAsync).mockImplementationOnce(async () => {
      order.push('tray cleared');
      mockTray.clear();
    });

    await wipeLibrary();

    expect(order).toEqual(['unregistered', 'tray cleared']);
  });

  it('still wipes the library when the tray cannot be cleared', async () => {
    await seedAthleteA();
    jest.mocked(Notifications.dismissAllNotificationsAsync).mockRejectedValueOnce(new Error('no'));
    jest
      .mocked(Notifications.cancelAllScheduledNotificationsAsync)
      .mockRejectedValueOnce(new Error('no'));

    await wipeLibrary();

    expect(BACKUP_FILES.filter((uri) => mockFiles.has(uri))).toEqual([]);
  });

  it('takes every restore copy inside the directory the wipe deletes', async () => {
    const restoreCopies: string[] = [];
    mockEngine.restoreRecordZip.mockImplementation(async () => {
      restoreCopies.push(
        ...[...mockFiles.keys()].filter((uri) => uri.startsWith('file:///cache/'))
      );
      return { unplaced: 0, missingActivityIds: [] };
    });
    mockFiles.set('file:///picked/athlete-a.zip', 'zip');
    mockFiles.set('file:///picked/athlete-a.veloqdb', 'db');

    await restoreRecordBackup('file:///picked/athlete-a.zip');
    await restoreDatabaseBackup('file:///picked/athlete-a.veloqdb');

    expect(restoreCopies.length).toBeGreaterThanOrEqual(3);
    expect(restoreCopies.filter((uri) => !uri.startsWith('file:///cache/restores/'))).toEqual([]);
  });

  it("unregisters the previous athlete's push token before turning notifications off", async () => {
    await seedAthleteA();

    await wipeLibrary();

    expect(unregisterPushToken).toHaveBeenCalledWith(ATHLETE_A);
    expect(useNotificationPreferences.getState().pendingUnregister).toBe(false);
  });

  it('records the unregister for the launch retry when it cannot reach the server', async () => {
    await seedAthleteA();
    jest.mocked(unregisterPushToken).mockResolvedValueOnce(false);

    await wipeLibrary();

    expect(useNotificationPreferences.getState().enabled).toBe(false);
    expect(resolvePendingUnregisterAthleteId()).toBe(ATHLETE_A);
  });

  it('unregisters once when the sign-out clears the credential after the wipe', async () => {
    await seedAthleteA();
    jest.mocked(unregisterPushToken).mockClear();

    await wipeLibrary();
    await useAuthStore.getState().clearCredentials();

    expect(unregisterPushToken).toHaveBeenCalledTimes(1);
    expect(unregisterPushToken).toHaveBeenCalledWith(ATHLETE_A);
  });
});

/** What a wiped entry is seeded with, and has to be gone after the wipe. */
interface Seeds {
  /** File uris, under `file:///docs/` and `file:///cache/`. */
  files?: string[];
  /** SecureStore keys. */
  keychain?: string[];
  /** AsyncStorage keys written directly. */
  storage?: string[];
  /** Keys written through `setSetting`, to AsyncStorage and the settings table at once. */
  settings?: string[];
  /** Settings-table keys JavaScript writes on the engine directly. */
  engineSettings?: string[];
  /** The widget's snapshot file and the launcher shortcuts. */
  widget?: true;
  /** The tray and the schedule. */
  tray?: true;
  /** Activity pushes queued in WorkManager. */
  pushJobs?: true;
  /** The image loader's disk cache, cleared through the native module. */
  imageCache?: true;
  /** Taken through the Rust tile store's `clearTiles`, which has to be called. */
  basemap?: true;
  /**
   * Taken by the engine's own clear, which this suite mocks, so the seed is
   * the call and the Rust test named here holds what it deletes.
   */
  engine?: string;
}

interface DeviceWrite {
  /** Where it is written. */
  where: string;
  /** Every file `scripts/lint-device-writes.mjs` counts a write to it in. */
  writers: string[];
  /** What it holds. */
  holds: string;
  /** How the wipe takes it. */
  wiped?: Seeds;
  /** Why the wipe leaves it on purpose. */
  kept?: string;
  /**
   * Something of the athlete's the wipe does not take yet, and why. Each is
   * filed as work of its own, and moves to `wiped` when that lands.
   */
  owed?: string;
}

const RUST = 'modules/veloqrs/rust/veloqrs/src';

/**
 * Every place the app or the engine writes on the device, built from the code:
 * the documents, cache and temporary directories, the App Group and the
 * widget's files, Android preferences, AsyncStorage, the settings table,
 * SecureStore, the tray, and every path the engine opens for writing.
 */
const DEVICE_WRITES: DeviceWrite[] = [
  // The library and what sits beside it.
  {
    where: 'routes.db and its -wal and -shm, in the App Group on iOS and filesDir on Android',
    writers: [
      'src/shared/native/engine.ts',
      'modules/veloq-app-group/ios/VeloqAppGroupModule.swift',
      'push/ios/VeloqPushExtension/VeloqPushPayload.swift',
      'modules/veloqrs/android/src/main/java/com/veloq/ActivityPushWorker.kt',
      `${RUST}/persistence/mod.rs`,
      `${RUST}/persistence/sections/detection.rs`,
      `${RUST}/persistence/tiles.rs`,
      'modules/veloqrs/src/EngineClient.ts',
    ],
    holds: 'the whole library: activities, tracks, sections, routes, wellness, the athlete profile',
    wiped: { engine: 'clear_forgets_the_record_restore_state and the persistence clear_ tests' },
  },
  {
    where:
      "settings-table keys Rust's clear deletes: owner, detector, cutover, record restore, curve stamps",
    writers: [
      'src/app/_layout.tsx',
      'src/features/auth/lib/accountChange.ts',
      'modules/veloqrs/src/delegates/settings.ts',
    ],
    holds: 'the athlete id, the detector configuration, activity ids owed to a restore',
    wiped: { engine: 'clear_forgets_the_record_restore_state' },
  },
  {
    where: 'routes.db.init.lock beside the database',
    writers: [`${RUST}/persistence/mod.rs`, `${RUST}/persistence/file_lock.rs`],
    holds: 'nothing: an empty file the init takes a lock on',
    kept: 'it holds no data, and the next open takes it again',
  },
  {
    where: 'veloq_panic.log beside the database',
    writers: [`${RUST}/persistence/mod.rs`, 'src/features/settings/lib/databaseSidecars.ts'],
    holds: "every engine panic's message, which can name an activity or a section",
    wiped: { files: ['file:///docs/veloq_panic.log'] },
  },
  {
    where: 'routes.db.corrupt-<seconds> and its pair, beside the database and in Documents',
    writers: [`${RUST}/persistence/mod.rs`, `${RUST}/persistence/sections/history.rs`],
    holds: 'a whole copy of a library that would not open',
    wiped: {
      files: [
        'file:///docs/routes.db.corrupt-1759219200',
        'file:///docs/routes.db.corrupt-1759219200-wal',
      ],
    },
  },
  {
    where: 'routes.db.displaced-<stamp> and its pair, a library the App Group move found there',
    writers: ['src/shared/native/engine.ts'],
    holds: 'a whole copy of a library',
    wiped: {
      files: [
        'file:///docs/routes.db.displaced-20261001T080000000Z',
        'file:///docs/routes.db.displaced-20261001T080000000Z-wal',
      ],
    },
  },
  {
    where: 'routes.db.clear-bak and its pair, the derived-data clear rollback',
    writers: [
      'src/features/settings/lib/clearSnapshot.ts',
      'modules/veloqrs/src/EngineClient.ts',
      `${RUST}/persistence/export.rs`,
    ],
    holds: 'a whole copy of the library',
    wiped: { files: ['file:///docs/routes.db.clear-bak', 'file:///docs/routes.db.clear-bak-wal'] },
  },

  // Backups and the record zip.
  {
    where: 'Documents/veloq-decisions.zip, the record the device backup carries',
    writers: [
      'src/shared/storage/platformRecord.ts',
      'src/features/settings/lib/autobackup/autoBackup.ts',
      'modules/veloqrs/src/EngineClient.ts',
      `${RUST}/persistence/record_backup.rs`,
    ],
    holds: 'the athlete id and every decision; a stale worker cannot publish after the wipe',
    wiped: { files: ['file:///docs/veloq-decisions.zip'] },
  },
  {
    where:
      'veloq-record-* beside a record destination: the zip before its rename, a conversion copy',
    writers: [`${RUST}/persistence/record_backup.rs`, 'src/shared/storage/platformRecord.ts'],
    holds: 'a record named for the athlete, or a whole older library mid-conversion, after a kill',
    wiped: {
      files: [
        'file:///docs/veloq-record-a1B2c3',
        'file:///docs/veloq-record-d4E5f6/import.db',
        'file:///docs/veloq-record-d4E5f6/import.db-wal',
        'file:///cache/restores/veloq-record-g7H8i9/import.db',
        'file:///cache/exports/veloq-record-j0K1l2',
      ],
    },
  },
  {
    where: 'Documents/backups/, the local backups and old database copies',
    writers: [
      'src/features/settings/lib/autobackup/backends/localBackend.ts',
      'src/features/settings/components/BackupSection.tsx',
    ],
    holds: 'record zips and whole-library .veloqdb copies',
    wiped: {
      files: [
        'file:///docs/backups/veloq-2026-09-30T08-00-00-000Z.zip',
        'file:///docs/backups/veloq-2026-03-01T08-00-00-000Z.veloqdb',
      ],
    },
  },
  {
    where: 'cache/restores/, every restore copy and a WebDAV download',
    writers: [
      'src/features/settings/lib/backup.ts',
      'src/features/settings/lib/autobackup/backends/webdavBackend.ts',
    ],
    holds: 'a backup being restored',
    wiped: { files: ['file:///cache/restores/restore-temp.zip'] },
  },
  {
    where: 'Documents/veloq-held-import.veloq or .zip, an older backup picked while signed out',
    writers: ['src/features/settings/lib/heldImport.ts'],
    holds: "an older backup's names and settings, waiting for a sign-in",
    kept: 'it exists only while nobody is signed in, so the wipe meets it only for the athlete picking it, at their sign-in or a demo entry, and the first signed-in launch restores and deletes it',
  },
  {
    where: 'cache/exports/, every file the share sheet is handed',
    writers: [
      'src/shared/storage/cacheFiles.ts',
      'src/features/settings/lib/shareFile.ts',
      'src/features/settings/lib/bulkExport.ts',
    ],
    holds: 'backups, activity exports, GPX, the crash log',
    wiped: { files: ['file:///cache/exports/veloq-activities-2026-10-01.zip'] },
  },
  {
    where: 'cache/notification_routes/, the pictures older builds attached to notifications',
    writers: [],
    holds: "a ride's route line",
    wiped: { files: ['file:///cache/notification_routes/a1.png'] },
  },
  {
    where: "cache/DocumentPicker/, the picker's copy of a file chosen for import",
    writers: [],
    holds: 'a backup the athlete picked',
    wiped: { files: ['file:///cache/DocumentPicker/0f6c2a1e.zip'] },
  },
  {
    where: 'exports and restore copies older builds wrote at the cache root',
    writers: [],
    holds: 'activity exports, GPX, backups, restore copies',
    wiped: {
      files: [
        'file:///cache/veloq-activities-2026-09-30.zip',
        'file:///cache/Morning_Ride.gpx',
        'file:///cache/veloq-backup-2026-09-30.zip',
        'file:///cache/veloq-autobackup-1759219200000.veloqdb',
        'file:///cache/restore-temp.veloqdb',
      ],
    },
  },
  {
    where: 'Documents/gps_tracks/ and Documents/bounds_cache/, from builds before the engine',
    writers: ['src/shared/storage/gpsStorage.ts'],
    holds: 'GPS tracks, bounds and route names',
    wiped: {
      files: [
        'file:///docs/gps_tracks/i1.json',
        'file:///docs/bounds_cache/bounds.json',
        'file:///docs/bounds_cache/route_names.json',
      ],
    },
  },

  // Maps.
  {
    where: 'Documents/terrain_previews/ and the terrain-preview-order key',
    writers: [
      'src/features/maps/lib/storage/terrainPreviewCache.ts',
      'src/shared/storage/terrainPreviewRoot.ts',
    ],
    holds: "pictures of the athlete's activities, keyed by activity id",
    wiped: {
      files: ['file:///docs/terrain_previews/i1.jpg'],
      storage: ['terrain-preview-order'],
    },
  },
  {
    where: 'veloq-pending-terrain-snapshots in AsyncStorage',
    writers: ['src/features/maps/lib/storage/terrainPreviewCache.ts'],
    holds: 'activity ids waiting for a preview',
    wiped: { storage: ['veloq-pending-terrain-snapshots'] },
  },
  {
    where: 'terrain-preview-cache-version in AsyncStorage',
    writers: ['src/features/maps/lib/storage/terrainPreviewCache.ts'],
    holds: 'the preview format version',
    kept: 'a format stamp, no athlete data',
  },
  {
    where: 'cache/heatmap-tiles/: tiles, version.txt, .dirty, corrupt-activities.json',
    writers: [
      'src/features/maps/lib/heatmapTiles.ts',
      'modules/veloqrs/src/delegates/heatmap.ts',
      `${RUST}/tiles.rs`,
      `${RUST}/atomic_file.rs`,
      `${RUST}/persistence/tiles.rs`,
    ],
    holds: "a heatmap of the athlete's rides",
    wiped: { engine: 'the clear-all wipe of the tile sets, wipe_tile_sets' },
  },
  {
    where: 'Documents/heatmap-tiles/, where builds before 0.3.0 drew the heatmap',
    writers: ['src/features/maps/lib/heatmapTiles.ts'],
    holds: "a heatmap of the athlete's rides, on an install upgraded from those builds",
    wiped: { files: ['file:///docs/heatmap-tiles/12/2148/1436.png'] },
  },
  {
    where: 'Documents/basemap-tiles/, the map tile store and its pinned ground',
    writers: [
      'src/shared/app/launch.ts',
      `${RUST}/basemap/store.rs`,
      `${RUST}/atomic_file.rs`,
      `${RUST}/basemap/mod.rs`,
    ],
    holds: "map tiles browsed, and low zooms pinned around the athlete's activity bounds",
    wiped: {
      files: [
        'file:///docs/basemap-tiles/openfreemap/3/4/2.pbf',
        'file:///docs/basemap-tiles/openfreemap/index.json',
      ],
      basemap: true,
    },
  },

  // Recording.
  {
    where: 'Documents/recordings/ and the legacy pending_uploads/',
    writers: ['src/features/recording/lib/storage/recordingLibrary.ts'],
    holds: 'rides recorded on this device',
    kept: "recordings stay through a wipe by decision, and the next sign-in holds every ride that is not that athlete's",
  },
  {
    where:
      'Documents/recording_backup.json and recording_backup_<athlete>.json, their .tmp siblings, and the AsyncStorage ownerless_recording_backup_settled marker and ownerless_recording_backup_pending_athlete key',
    writers: [
      'src/features/recording/lib/storage/recordingBackup.ts',
      'src/shared/native/replaceFile.ts',
    ],
    holds:
      'the ride in progress, whether an unowned backup from an older build went to its athlete, and which athlete a failed adoption retries for',
    kept: 'a ride in progress, cleared with its temporary file when saved or discarded; stale temporary files are removed on load; the marker and the pending athlete stay so a later library is never handed a ride it did not record',
  },
  {
    where: 'recording-notification-actions.txt in filesDir',
    writers: [
      'modules/veloq-recording-notification/android/src/main/java/com/veloq/recording/RecordingActionReceiver.kt',
    ],
    holds: 'notification button presses queued while JavaScript was not running',
    kept: 'session times and action names, no athlete data, drained at the next launch',
  },
  {
    where: 'the recording foreground notification and the iOS Live Activity',
    writers: [
      'modules/veloq-recording-notification/android/src/main/java/com/veloq/recording/VeloqRecordingNotificationModule.kt',
      'modules/veloq-live-activity/ios/VeloqLiveActivityModule.swift',
    ],
    holds: 'the ride in progress, its time, distance and trace',
    kept: 'it belongs to a recording in progress and ends with it',
  },
  {
    where: 'the recording preferences',
    writers: ['src/features/recording/stores/RecordingPreferencesStore.ts'],
    holds: 'display and behaviour choices for recording',
    kept: 'a preference of the device, no athlete data',
  },
  {
    where: 'veloq-upload-permission',
    writers: ['src/features/recording/stores/UploadPermissionStore.ts'],
    holds: 'the scopes the previous account granted',
    wiped: { settings: ['veloq-upload-permission'] },
  },

  // The image loader.
  {
    where: "the image loader's disk cache: Fresco's on Android, the shared URL cache on iOS",
    writers: [],
    holds: "the athlete's profile photo, fetched by the core Image component",
    wiped: { imageCache: true },
  },
  // The widget and the launcher.
  {
    where: 'widget-snapshot.json, in the App Group on iOS and filesDir on Android, and its .tmp',
    writers: [
      'modules/veloq-widget/ios/VeloqWidgetModule.swift',
      'modules/veloq-widget/android/src/main/java/com/veloq/widget/VeloqWidgetModule.kt',
      'modules/veloqrs/android/src/main/java/com/veloq/WidgetSnapshotFile.kt',
      'widget/ios/VeloqWidget/WidgetSnapshotModel.swift',
      'widget/ios/shared/RecordSportEntity.swift',
      'widget/android/java/WidgetSnapshot.kt',
    ],
    holds:
      'the latest ride with its route outline, form, fitness, HRV, resting heart rate, weekly totals',
    wiped: { widget: true },
  },
  {
    where: "the Android launcher's dynamic record shortcuts",
    writers: ['modules/veloq-widget/android/src/main/java/com/veloq/widget/VeloqWidgetModule.kt'],
    holds: 'the sports most recently recorded',
    wiped: { widget: true },
  },
  {
    where: 'the veloq_widget_prefs and veloq_record_widget preference files',
    writers: [
      'widget/android/java/VeloqWidgetProvider.kt',
      'widget/android/java/RecordWidgetChoice.kt',
    ],
    holds: "each placed widget's metric or sport link",
    kept: 'the configuration of a placed widget, no athlete data, removed with the widget',
  },

  // Notifications.
  {
    where: 'the tray and the schedule',
    writers: [
      'src/features/settings/lib/notificationService.ts',
      'modules/veloqrs/android/src/main/java/com/veloq/ActivityNotificationPoster.kt',
    ],
    holds: 'ride names, PRs, route pictures and the athlete id a tap checks',
    wiped: { tray: true },
  },
  {
    where: 'the veloq-insights channel and the background insight task registration',
    writers: [
      'src/features/insights/backgroundInsightTask.ts',
      'src/features/settings/lib/notificationService.ts',
      'modules/veloqrs/android/src/main/java/com/veloq/ActivityNotificationPoster.kt',
    ],
    holds: 'a channel definition and a task name',
    kept: 'no athlete data',
  },
  {
    where: 'veloq-insight-task-runs in AsyncStorage',
    writers: ['src/features/insights/lib/taskRunLog.ts'],
    holds: 'activity ids and events the background task handled',
    wiped: { storage: ['veloq-insight-task-runs'] },
  },
  {
    where: "WorkManager's database: a queued activity-push-<athlete>-<activity> job",
    writers: ['modules/veloqrs/android/src/main/java/com/veloq/ActivityPushWorker.kt'],
    holds: 'the athlete id and an activity id',
    wiped: { pushJobs: true },
  },
  {
    where: 'veloq-insights-fingerprint',
    writers: [
      'src/features/insights/lib/fingerprintStore.ts',
      'src/shared/storage/migrateSettingsToSqlite.ts',
    ],
    holds: 'the insight ids the athlete has already been shown',
    wiped: { settings: ['veloq-insights-fingerprint'] },
  },
  {
    where: 'veloq-notification-preferences',
    writers: ['src/features/settings/stores/NotificationPreferencesStore.ts'],
    holds: 'consent, categories, and the athlete a failed unregister is owed for',
    wiped: { settings: ['veloq-notification-preferences'] },
  },
  {
    where: 'veloq-push-token-registered and veloq-push-token-refreshed-at',
    writers: ['src/features/settings/lib/pushTokenRegistration.ts'],
    holds: "the device's push token and when it was refreshed",
    kept: "the device's token, not the athlete's, and the wipe releases its registration on the server",
  },
  {
    where: 'veloq-notification-prompt-dismissed',
    writers: [
      'src/features/settings/stores/NotificationPromptStore.ts',
      'src/shared/storage/migrateSettingsToSqlite.ts',
    ],
    holds: 'whether the athlete dismissed the opt-in card',
    wiped: { settings: ['veloq-notification-prompt-dismissed'] },
  },

  // Credentials and the backup carrier.
  {
    where: 'the sign-in credential in SecureStore: key, token, athlete id, key owner',
    writers: [
      'src/shared/app/AuthStore.ts',
      'src/shared/app/credentialKeychain.ts',
      'modules/veloqrs/android/src/main/java/com/veloq/SecureStoreReader.kt',
    ],
    holds: 'the credential of the athlete signed in',
    kept: 'the wipe runs for the athlete signing in, and every sign-out clears it through clearCredentials',
  },
  {
    where: 'intervals_pending_api_key in SecureStore',
    writers: ['src/features/auth/lib/pendingSignIn.ts'],
    holds: 'a key typed offline',
    wiped: { keychain: ['intervals_pending_api_key'] },
  },
  {
    where: 'the WebDAV server, user, password and plain-LAN flag in SecureStore',
    writers: ['src/features/settings/lib/autobackup/webdavConfig.ts'],
    holds: "the athlete's backup server login",
    wiped: {
      keychain: ['veloq-webdav-url', 'veloq-webdav-username', 'veloq-webdav-password'],
    },
  },
  {
    where: 'the backup backend, toggle, last run and last failure',
    writers: ['src/features/settings/lib/autobackup/autoBackup.ts'],
    holds: "where and when the athlete's records were sent",
    wiped: {
      engineSettings: [
        '__backup_backend',
        '__auto_backup_enabled',
        '__last_auto_backup',
        '__last_backup_failure',
      ],
    },
  },
  {
    where: 'the backup folder the athlete picked: its tree grant or bookmark, and its name',
    writers: ['src/shared/native/backupFolder.ts'],
    holds: "where on the athlete's own storage their records are copied",
    wiped: { engineSettings: ['__backup_folder', '__backup_folder_name'] },
  },
  {
    where: 'cached_athlete_id and stored_activity_count in AsyncStorage',
    writers: ['src/shared/storage/cachedAthleteId.ts'],
    holds: 'the athlete id and the size of the library',
    wiped: { storage: ['cached_athlete_id', 'stored_activity_count'] },
  },

  // Settings that survive Rust's clear.
  {
    where: '__export_home_lat, __export_home_lng and __export_privacy_radius_m',
    writers: ['src/features/settings/components/ExportPrivacyRow.tsx'],
    holds: "the athlete's home coordinates",
    wiped: { engine: 'clear_forgets_the_athletes_home_and_sync_history' },
  },
  {
    where: 'oldest_activity_date, activity_year_counts and sync.last_success_at',
    writers: ['src/shared/app/seedDemoEngine.ts'],
    holds: "the span and yearly counts of the athlete's history, and the last sync",
    wiped: { engine: 'clear_forgets_the_athletes_home_and_sync_history' },
  },
  {
    where: '@terrain_camera_overrides, veloq-map-activity-overrides, veloq-track-fetch-dismissed',
    writers: [
      'src/features/maps/lib/storage/terrainCameraOverrides.ts',
      'src/features/maps/stores/MapPreferencesContext.tsx',
      'src/features/routes/lib/trackFetchNotice.ts',
      'src/shared/storage/migrateSettingsToSqlite.ts',
    ],
    holds: 'choices keyed by activity id',
    wiped: {
      settings: [
        '@terrain_camera_overrides',
        'veloq-map-activity-overrides',
        'veloq-track-fetch-dismissed',
      ],
    },
  },
  {
    where: '@map_camera_state',
    writers: ['src/features/maps/lib/storage/mapCameraState.ts'],
    holds: 'where the map was last centred',
    wiped: { settings: ['@map_camera_state'] },
  },
  {
    where: 'veloq-known-sensors',
    writers: ['src/features/sensors/store.ts', 'src/shared/storage/migrateSettingsToSqlite.ts'],
    holds: 'paired sensor ids and the names they advertise',
    wiped: { settings: ['veloq-known-sensors'] },
  },
  {
    where: 'the legacy section and route id keys an old build left, and their engine copies',
    writers: ['src/shared/storage/migrateSettingsToSqlite.ts'],
    holds: 'disabled, superseded, dismissed and geocoded section and route ids',
    wiped: {
      settings: [
        'veloq-disabled-sections',
        'veloq-superseded-sections',
        'veloq-section-dismissals',
        'veloq-geocoded-route-ids',
        'veloq-geocoded-section-ids',
      ],
    },
  },
  {
    where: 'veloq-insight-push-history in AsyncStorage, written by an earlier install',
    writers: [],
    holds: 'the times of the most recent insight pushes',
    wiped: { storage: ['veloq-insight-push-history'] },
  },
  {
    where: 'veloq-crash-log in AsyncStorage',
    writers: ['src/shared/debug/crashLog.ts'],
    holds: 'error messages and stacks, which can carry a name or an id',
    wiped: { storage: ['veloq-crash-log'] },
  },
  {
    where: 'version stamps: section health check, settings store',
    writers: [
      'src/features/routes/hooks/useSectionHealthCheck.ts',
      'src/shared/storage/migrateSettingsToSqlite.ts',
    ],
    holds: 'which one-time passes have run',
    kept: 'stamps, no athlete data',
  },
  {
    where:
      'device preferences: units, language, theme, sport, dashboard, map, routes, heatmap, tiles, debug, support, what is new',
    writers: [
      'src/shared/app/UnitPreferenceStore.ts',
      'src/shared/app/LanguageStore.ts',
      'src/shared/app/ThemeProvider.ts',
      'src/features/fitness/stores/SportPreferenceStore.ts',
      'src/features/home/store.ts',
      'src/features/maps/stores/HeatmapPreferenceStore.ts',
      'src/features/maps/lib/storage/tileCacheSettings.ts',
      'src/features/routes/stores/RouteSettingsStore.ts',
      'src/features/settings/stores/DebugStore.ts',
      'src/features/settings/stores/WhatsNewStore.ts',
      'src/shared/app/SupportStore.ts',
      'src/shared/storage/migrateSettingsToSqlite.ts',
      'src/shared/storage/settingsStorage.ts',
    ],
    holds:
      'display and behaviour choices, including the detection switch reconciled at launch and restore',
    kept: 'a preference of the device, no athlete data',
  },
  {
    where:
      'the excluded-from-backup attribute on the tile, preview and local backup directories and the set-aside library copies',
    writers: [
      'modules/veloq-backup-exclusion/ios/VeloqBackupExclusionModule.swift',
      'src/features/settings/lib/quarantineReport.ts',
    ],
    holds: 'a file attribute',
    kept: 'no data',
  },
  {
    where: 'the wipe and backup sweep, which name the roots they delete from',
    writers: ['src/shared/storage/gpsStorage.ts', 'src/features/settings/lib/backupCache.ts'],
    holds: 'nothing of its own',
    kept: 'it writes nothing',
  },
];

function seed(entry: DeviceWrite) {
  const seeds = entry.wiped ?? {};
  for (const uri of seeds.files ?? []) mockFiles.set(uri, 'athlete-a');
  for (const key of seeds.keychain ?? []) mockKeychain.set(key, 'athlete-a');
  for (const key of seeds.storage ?? []) mockAsyncStorage.set(key, 'athlete-a');
  for (const key of seeds.settings ?? []) mockSettings.set(key, 'athlete-a');
  for (const key of seeds.engineSettings ?? []) mockEngineSettings.set(key, 'athlete-a');
  if (seeds.widget) {
    writeWidgetSnapshot({
      json: JSON.stringify({ latest: { activityId: 'i999', name: 'Morning Ride' } }),
      launcherShortcuts: [{ type: 'Ride', label: 'Ride', url: 'veloq://record?type=Ride' }],
    });
  }
  if (seeds.tray) mockTray.add('activity-i999');
  if (seeds.pushJobs) mockPushJobs.add('activity-push-i12345-i999');
  if (seeds.imageCache) mockImageDiskCache = ['https://example.com/photos/athlete-a.jpg'];
}

/** Whatever of `entry`'s seed is still there. */
function survivors(entry: DeviceWrite): string[] {
  const seeds = entry.wiped ?? {};
  const kept = (keys: string[] | undefined, store: Map<string, string>) =>
    (keys ?? []).filter((key) => store.get(key) === 'athlete-a');
  return [
    ...(seeds.files ?? []).filter((uri) => mockFiles.has(uri)),
    ...kept(seeds.keychain, mockKeychain),
    ...kept(seeds.storage, mockAsyncStorage),
    ...kept(seeds.settings, mockSettings),
    ...kept(seeds.engineSettings, mockEngineSettings),
    ...(seeds.widget && mockWidget.snapshot !== null ? ['widget snapshot'] : []),
    ...(seeds.widget && mockWidget.shortcuts.length > 0 ? ['launcher shortcuts'] : []),
    ...(seeds.tray ? [...mockTray] : []),
    ...(seeds.pushJobs ? [...mockPushJobs] : []),
    ...(seeds.imageCache ? mockImageDiskCache : []),
  ];
}

describe('every place the app writes on the device', () => {
  it('names every file the write guard counts, and no other', () => {
    const named = new Set(DEVICE_WRITES.flatMap((entry) => entry.writers));
    const counted = Object.keys(deviceWriteSites);

    expect(counted.filter((file) => !named.has(file))).toEqual([]);
    expect([...named].filter((file) => !counted.includes(file))).toEqual([]);
  });

  it('says of each place whether the wipe takes it, keeps it, or owes it', () => {
    const undecided = DEVICE_WRITES.filter(
      (entry) => [entry.wiped, entry.kept, entry.owed].filter(Boolean).length !== 1
    );
    expect(undecided.map((entry) => entry.where)).toEqual([]);
  });

  it.each(DEVICE_WRITES.filter((entry) => entry.wiped).map((entry) => [entry.where, entry]))(
    'takes %s',
    async (_where, entry) => {
      await seedAthleteA();
      mockEngine.clear.mockClear();
      mockClearTiles.mockClear();
      seed(entry);

      await wipeLibrary();

      expect(survivors(entry)).toEqual([]);
      if (entry.wiped?.engine) expect(mockEngine.clear).toHaveBeenCalledWith('/docs/routes.db');
      if (entry.wiped?.basemap) expect(mockClearTiles).toHaveBeenCalled();
    }
  );
});

describe('the basemap tile store at a wipe', () => {
  const tile = 'file:///docs/basemap-tiles/openfreemap/3/4/2.pbf';

  afterEach(() => {
    mockClearTiles.mockClear();
  });

  it('deletes the tile directory itself when the store was never opened', async () => {
    mockClearTiles.mockImplementationOnce(() => {
      throw new Error('basemap store has no path');
    });
    mockFiles.set(tile, 'athlete-a');

    await wipeLibrary();

    expect(mockFiles.has(tile)).toBe(false);
  });

  it('still finishes the rest of the wipe when the store cannot be cleared', async () => {
    mockClearTiles.mockImplementationOnce(() => {
      throw new Error('basemap store has no path');
    });
    mockFiles.set('file:///docs/veloq_panic.log', 'panic at i998');
    mockRouteDbPath.mockReturnValue('/docs/routes.db');

    await wipeLibrary();

    expect(mockFiles.has('file:///docs/veloq_panic.log')).toBe(false);
  });
});

/**
 * Scenario: the stores that hold a wiped key in memory as well, still mounted
 * when the wipe runs.
 *
 * Expected behaviour: each forgets what it held, so its next write cannot put
 * the previous athlete's activity ids, crash messages or scopes back.
 */
describe("an older build's ownerless crash backup at a wipe", () => {
  it('is left on disk and never adopted by the athlete the library is named for next', async () => {
    const backupPath = `${FileSystem.documentDirectory}recording_backup.json`;
    const ownerless = JSON.stringify({
      version: 2,
      activityType: 'Ride',
      mode: 'gps',
      status: 'stopped',
      startTime: 1_000_000,
      stopTime: 1_900_000,
      pausedDuration: 0,
      savedAt: 1_900_000,
      streams: { time: [], latlng: [] },
      laps: [],
    });
    mockFiles.set(backupPath, ownerless);
    await wipeLibrary();
    const { adoptOwnerlessRecordingBackup } = require('@/features/recording');
    await adoptOwnerlessRecordingBackup(async () => 'athlete-b');

    expect(mockFiles.get(backupPath)).toBe(ownerless);
    expect([...mockFiles.keys()].some((k) => k.includes('recording_backup_athlete-b'))).toBe(false);
  });
});

describe('the stores the wipe empties', () => {
  const camera = { center: [7.5, 46.9], zoom: 13, pitch: 60, bearing: 0 } as never;

  it('forgets the camera overrides, so the next one saved carries none of them', async () => {
    await setCameraOverride('i999', camera);

    await wipeLibrary();
    await setCameraOverride('b1', camera);

    expect(getCameraOverride('i999')).toBeUndefined();
    expect(JSON.parse(mockSettings.get('@terrain_camera_overrides') ?? '{}')).toEqual({
      b1: camera,
    });
  });

  it('forgets the last map position', async () => {
    saveMapCameraState([7.5, 46.9], 14);

    await wipeLibrary();

    expect(getMapCameraState()).toBeNull();
  });

  it('forgets the paired sensors and what was discovered', async () => {
    useSensorStore.getState().addKnownSensor({
      id: 'aa:bb',
      name: 'Strap',
      kind: 'heartRate',
    } as never);
    useSensorStore.getState().upsertDiscovered({ id: 'cc:dd', name: 'Strap 2' } as never);

    await wipeLibrary();

    expect(useSensorStore.getState().knownSensors).toEqual([]);
    expect(useSensorStore.getState().discovered).toEqual([]);
    expect(useSensorStore.getState().connections).toEqual({});
    expect(mockSettings.has('veloq-known-sensors')).toBe(false);
  });

  it('forgets the dismissed track notice', async () => {
    reportTrackFetchRun({ failedIds: ['i999'] });
    useTrackFetchNotice.getState().dismiss();

    await wipeLibrary();
    reportTrackFetchRun({ failedIds: ['i999'] });

    expect(useTrackFetchNotice.getState().dismissedKey).toBeNull();
    expect(useTrackFetchNotice.getState().failedIds).toEqual(['i999']);
    expect(useTrackFetchNotice.getState().dismissed).toBe(false);
  });

  it('forgets the crash log, so the next crash is the only one in it', async () => {
    recordCrash({ source: 'js-global', message: 'Morning Ride i999' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    await wipeLibrary();
    recordCrash({ source: 'js-global', message: 'athlete b' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect((await getCrashLog()).map((entry) => entry.message)).toEqual(['athlete b']);
  });

  it('forgets the scopes the previous account granted', async () => {
    useUploadPermissionStore.getState().setFromOAuthScope('ACTIVITY:READ,ACTIVITY:WRITE');

    await wipeLibrary();

    expect(useUploadPermissionStore.getState().grantedScopes).toBeNull();
    expect(useUploadPermissionStore.getState().hasWritePermission).toBeNull();
  });

  it('leaves the scope unanswered rather than checking for an athlete already signed in', async () => {
    useAuthStore.setState({ athleteId: 'i67890', authMethod: 'oauth', isAuthenticated: true });
    useUploadPermissionStore.getState().setFromOAuthScope('ACTIVITY:READ,ACTIVITY:WRITE');

    await wipeLibrary();

    expect(useUploadPermissionStore.getState().grantedScopes).toBeNull();
    expect(useUploadPermissionStore.getState().isLoaded).toBe(true);
  });

  it('leaves the scope unknown for the sign-in to answer when nobody is signed in', async () => {
    useAuthStore.setState({ athleteId: null, authMethod: null, isAuthenticated: false });
    useUploadPermissionStore.getState().setFromOAuthScope('ACTIVITY:READ,ACTIVITY:WRITE');

    await wipeLibrary();

    expect(useUploadPermissionStore.getState().isLoaded).toBe(false);
  });

  it('forgets the per-activity map overrides a mounted provider holds', async () => {
    const { result } = renderHook(() => useMapPreferences(), {
      wrapper: ({ children }: { children: React.ReactNode }) =>
        React.createElement(MapPreferencesProvider, null, children),
    });
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    await act(async () => {
      await result.current.setActivityOverride('i999', { terrain3D: true });
    });

    await act(async () => {
      await wipeLibrary();
    });
    await act(async () => {
      await result.current.setActivityOverride('b1', { style: 'dark' });
    });

    expect(result.current.hasActivityOverride('i999')).toBe(false);
    expect(
      Object.keys(JSON.parse(mockSettings.get('veloq-map-activity-overrides') ?? '{}'))
    ).toEqual(['b1']);
  });
});
