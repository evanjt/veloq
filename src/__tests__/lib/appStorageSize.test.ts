/**
 * Scenario: the settings hub shows one cache figure on mount.
 *
 * Expected behaviour: it comes from the four buckets that already know their
 * own size, three of them natively, not from a recursive walk of every file
 * under the document and cache directories.
 */
import { Platform } from 'react-native';

import { getAppStorageSize } from '@/shared/storage/gpsStorage';

const mockPlatformStats = jest.fn(
  async (): Promise<{ dataBytes: number; cacheBytes: number } | null> => null
);
jest.mock('@/shared/native/appStorageStats', () => ({
  getPlatformAppStorageStats: () => mockPlatformStats(),
}));

interface MockInfo {
  exists: boolean;
  isDirectory: boolean;
  size?: number;
}
const mockReadDirectory = jest.fn(async (_path: string): Promise<string[]> => []);
const mockGetInfo = jest.fn(
  async (_path: string): Promise<MockInfo> => ({ exists: false, isDirectory: false })
);

jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  documentDirectory: '/mock/docs/',
  cacheDirectory: '/mock/cache/',
  getInfoAsync: (path: string) => mockGetInfo(path),
  readDirectoryAsync: (path: string) => mockReadDirectory(path),
  deleteAsync: jest.fn(async () => {}),
  makeDirectoryAsync: jest.fn(async () => {}),
}));

const mockHeatmapSize = jest.fn(async () => 0);
jest.mock('@/features/maps/lib/heatmapTiles', () => ({
  HEATMAP_TILES_DIR: '/mock/cache/heatmap-tiles/',
  readHeatmapTilesCacheSize: () => mockHeatmapSize(),
}));

const mockBasemapSize = jest.fn(async (): Promise<number> => 0);
jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    basemapStore: () => ({ getCacheSize: () => mockBasemapSize() }),
  })
);

const mockTerrainSize = jest.fn(async () => 0);
jest.mock('@/features/maps/lib/storage/terrainPreviewCache', () => ({
  clearTerrainPreviews: jest.fn(async () => {}),
  getTerrainPreviewCacheSize: () => mockTerrainSize(),
}));

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(() => null),
  getRouteDbPath: jest.fn(() => '/mock/docs/routes.db'),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockReadDirectory.mockResolvedValue([]);
  mockGetInfo.mockResolvedValue({ exists: false, isDirectory: false });
  mockHeatmapSize.mockResolvedValue(0);
  mockBasemapSize.mockResolvedValue(0);
  mockTerrainSize.mockResolvedValue(0);
  mockPlatformStats.mockResolvedValue(null);
});

describe('getAppStorageSize', () => {
  it('sums the four buckets that know their own size', async () => {
    mockHeatmapSize.mockResolvedValue(100);
    mockBasemapSize.mockResolvedValue(200);
    mockTerrainSize.mockResolvedValue(10);

    // The routes database is the one bucket still measured by file, three
    // files for the main database and its two WAL sidecars.
    mockGetInfo.mockImplementation(async (path: unknown) =>
      String(path).includes('routes')
        ? { exists: true, isDirectory: false, size: 15 }
        : { exists: false, isDirectory: false }
    );

    expect(await getAppStorageSize()).toBe(100 + 200 + 10 + 45);
  });

  it('counts the backups, recordings, set-aside copies and cache snapshots', async () => {
    const dirs: Record<string, string[]> = {
      '/mock/docs/': [
        'backups',
        'recordings',
        'routes.db',
        'routes.db.corrupt-17',
        'routes.db.corrupt-17-wal',
      ],
      '/mock/docs/backups/': ['a.zip', 'b.zip'],
      '/mock/docs/recordings/': ['r1.json'],
      '/mock/cache/': [
        'veloq-autobackup-1.db',
        'veloq-backup-2.zip',
        'unrelated.bin',
        'exports',
        'restores',
      ],
      '/mock/cache/exports/': ['x.gpx'],
      '/mock/cache/restores/': [],
    };
    const sizes: Record<string, number> = {
      '/mock/docs/backups/a.zip': 1000,
      '/mock/docs/backups/b.zip': 2000,
      '/mock/docs/recordings/r1.json': 4000,
      '/mock/docs/routes.db.corrupt-17': 8000,
      '/mock/docs/routes.db.corrupt-17-wal': 16000,
      '/mock/cache/veloq-autobackup-1.db': 32000,
      '/mock/cache/veloq-backup-2.zip': 64000,
      '/mock/cache/unrelated.bin': 99999,
      '/mock/cache/exports/x.gpx': 128000,
    };
    mockReadDirectory.mockImplementation(async (path: string) => {
      const key = path.replace(/^file:\/\//, '');
      return dirs[key.endsWith('/') ? key : `${key}/`] ?? [];
    });
    mockGetInfo.mockImplementation(async (path: string) => {
      const key = path.replace(/^file:\/\//, '');
      if (dirs[key.endsWith('/') ? key : `${key}/`]) return { exists: true, isDirectory: true };
      const size = sizes[key];
      return size === undefined
        ? { exists: false, isDirectory: false }
        : { exists: true, isDirectory: false, size };
    });

    expect(await getAppStorageSize()).toBe(
      1000 + 2000 + 4000 + 8000 + 16000 + 32000 + 64000 + 128000
    );
  });

  it('never walks the tile trees', async () => {
    // Both trees exist and hold a tile, which is what the walk used to
    // recurse into one getInfoAsync at a time.
    const tree: Record<string, string[]> = {
      '/mock/docs/': ['basemap-tiles'],
      '/mock/docs/basemap-tiles/': ['1.png'],
      '/mock/cache/': ['heatmap-tiles'],
      '/mock/cache/heatmap-tiles/': ['1.png'],
    };
    mockGetInfo.mockImplementation(async (path: string) => {
      if (tree[path] || tree[`${path}/`]) return { exists: true, isDirectory: true, size: 0 };
      return { exists: true, isDirectory: false, size: 7 };
    });
    mockReadDirectory.mockImplementation(async (path: string) => tree[path] ?? []);

    await getAppStorageSize();

    const walked = mockReadDirectory.mock.calls.map((c) => String(c[0]));
    expect(walked.filter((path) => path.includes('-tiles'))).toEqual([]);
  });

  it('keeps the buckets that answered when one throws', async () => {
    mockHeatmapSize.mockImplementation(() => {
      throw new Error('engine not open');
    });
    mockBasemapSize.mockResolvedValue(200);

    expect(await getAppStorageSize()).toBe(200);
  });
});

describe('getAppStorageSize against the platform figure', () => {
  const originalOS = Platform.OS;
  afterEach(() => {
    Platform.OS = originalOS;
  });

  it('reports the platform data plus cache on Android, not the bucket sum', async () => {
    Platform.OS = 'android';
    mockHeatmapSize.mockResolvedValue(41_700_000);
    mockBasemapSize.mockResolvedValue(52_400_000);
    mockTerrainSize.mockResolvedValue(7_800_000);
    mockPlatformStats.mockResolvedValue({ dataBytes: 72_740_000, cacheBytes: 70_260_000 });

    expect(await getAppStorageSize()).toBe(143_000_000);
  });

  it('falls back to the bucket sum when the platform call throws', async () => {
    Platform.OS = 'android';
    mockHeatmapSize.mockResolvedValue(100);
    mockBasemapSize.mockResolvedValue(200);
    mockPlatformStats.mockRejectedValue(new Error('no stats'));

    expect(await getAppStorageSize()).toBe(300);
  });

  it('falls back to the bucket sum when the module is missing', async () => {
    Platform.OS = 'android';
    mockHeatmapSize.mockResolvedValue(100);
    mockPlatformStats.mockResolvedValue(null);

    expect(await getAppStorageSize()).toBe(100);
  });

  it('does not ask the platform on iOS', async () => {
    Platform.OS = 'ios';
    mockHeatmapSize.mockResolvedValue(100);
    mockPlatformStats.mockResolvedValue({ dataBytes: 9_000, cacheBytes: 9_000 });

    expect(await getAppStorageSize()).toBe(100);
    expect(mockPlatformStats).not.toHaveBeenCalled();
  });
});
