/**
 * Scenario: the settings hub shows one cache figure on mount.
 *
 * Expected behaviour: it comes from the four buckets that already know their
 * own size, three of them natively, not from a recursive walk of every file
 * under the document and cache directories.
 */
import { getAppStorageSize } from '@/shared/storage/gpsStorage';

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
  documentDirectory: '/mock/docs/',
  cacheDirectory: '/mock/cache/',
  getInfoAsync: (path: string) => mockGetInfo(path),
  readDirectoryAsync: (path: string) => mockReadDirectory(path),
  deleteAsync: jest.fn(async () => {}),
  makeDirectoryAsync: jest.fn(async () => {}),
}));

const mockHeatmapSize = jest.fn(() => 0);
jest.mock('@/features/maps/hooks/useHeatmapTiles', () => ({
  HEATMAP_TILES_DIR: '/mock/cache/heatmap-tiles/',
  getHeatmapTilesCacheSize: () => mockHeatmapSize(),
}));

const mockBasemapSize = jest.fn((): bigint => 0n);
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
  mockHeatmapSize.mockReturnValue(0);
  mockBasemapSize.mockReturnValue(0n);
  mockTerrainSize.mockResolvedValue(0);
});

describe('getAppStorageSize', () => {
  it('sums the four buckets that know their own size', async () => {
    mockHeatmapSize.mockReturnValue(100);
    mockBasemapSize.mockReturnValue(200n);
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

  it('never walks the document or cache directory', async () => {
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
    expect(walked).not.toContain('/mock/docs/');
    expect(walked).not.toContain('/mock/cache/');
  });

  it('keeps the buckets that answered when one throws', async () => {
    mockHeatmapSize.mockImplementation(() => {
      throw new Error('engine not open');
    });
    mockBasemapSize.mockReturnValue(200n);

    expect(await getAppStorageSize()).toBe(200);
  });
});
