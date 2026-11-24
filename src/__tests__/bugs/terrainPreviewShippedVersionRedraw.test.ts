/**
 * Scenario: a device holds previews stamped with version 12, the version a
 * released build drew them at, and the camera and imagery the previews are
 * drawn from have changed since.
 *
 * Expected behaviour: the first load clears those previews and stamps the
 * current version, so every card is redrawn rather than served the old image.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const DIR = '/mock/docs/terrain_previews/';
const mockFileStore = new Map<string, string>();
const mockDirStore = new Set<string>([DIR]);

jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  cacheDirectory: '/mock/cache/',
  documentDirectory: '/mock/docs/',
  EncodingType: { Base64: 'base64' },
  getInfoAsync: jest.fn(async (path: string) => ({
    exists: mockDirStore.has(path) || mockFileStore.has(path),
    isDirectory: mockDirStore.has(path),
    size: mockFileStore.get(path)?.length ?? 0,
  })),
  makeDirectoryAsync: jest.fn(async (path: string) => {
    mockDirStore.add(path);
  }),
  deleteAsync: jest.fn(async (path: string) => {
    mockFileStore.delete(path);
    for (const key of [...mockFileStore.keys()]) {
      if (key.startsWith(path)) mockFileStore.delete(key);
    }
    mockDirStore.delete(path);
  }),
  readDirectoryAsync: jest.fn(async (path: string) =>
    [...mockFileStore.keys()].filter((k) => k.startsWith(path)).map((k) => k.slice(path.length))
  ),
}));

type Cache = typeof import('@/features/maps/lib/storage/terrainPreviewCache');

function freshCache(): Cache {
  let cache!: Cache;
  jest.isolateModules(() => {
    cache = require('@/features/maps/lib/storage/terrainPreviewCache');
  });
  return cache;
}

const SHIPPED_VERSION = 12;

beforeEach(async () => {
  mockFileStore.clear();
  mockDirStore.clear();
  mockDirStore.add(DIR);
  await AsyncStorage.clear();
});

describe('previews drawn at the last shipped cache version', () => {
  it('are cleared and restamped on first load', async () => {
    const cache = freshCache();
    await AsyncStorage.setItem(cache.TERRAIN_PREVIEW_VERSION_KEY, String(SHIPPED_VERSION));
    mockFileStore.set(`${DIR}a1_light_3d.jpg`, 'bytes');

    await cache.initTerrainPreviewCache();

    expect(cache.TERRAIN_CACHE_VERSION).toBeGreaterThan(SHIPPED_VERSION);
    expect(cache.hasTerrainPreview('a1', 'light', true)).toBe(false);
    expect([...mockFileStore.keys()]).toEqual([]);
    expect(await AsyncStorage.getItem(cache.TERRAIN_PREVIEW_VERSION_KEY)).toBe(
      String(cache.TERRAIN_CACHE_VERSION)
    );
  });

  it('are kept when the stamp already matches the current version', async () => {
    const cache = freshCache();
    await AsyncStorage.setItem(
      cache.TERRAIN_PREVIEW_VERSION_KEY,
      String(cache.TERRAIN_CACHE_VERSION)
    );
    mockFileStore.set(`${DIR}a1_light_3d.jpg`, 'bytes');

    await cache.initTerrainPreviewCache();

    expect(cache.hasTerrainPreview('a1', 'light', true)).toBe(true);
  });
});
