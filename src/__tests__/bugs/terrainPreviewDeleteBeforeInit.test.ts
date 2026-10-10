/**
 * Scenario: the app cold-launches straight into an activity, so the preview
 * index is never built, and the athlete saves a new 3D camera there.
 *
 * Expected behaviour: the activity's old previews are still deleted, so its
 * card renders the new angle rather than serving the superseded file. Other
 * activities' previews stay.
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

beforeEach(async () => {
  mockFileStore.clear();
  mockDirStore.clear();
  mockDirStore.add(DIR);
  await AsyncStorage.clear();
  const { TERRAIN_CACHE_VERSION, TERRAIN_PREVIEW_VERSION_KEY } = freshCache();
  await AsyncStorage.setItem(TERRAIN_PREVIEW_VERSION_KEY, String(TERRAIN_CACHE_VERSION));
  for (const name of ['a1_light.jpg', 'a1_light_3d.jpg', 'a2_light_3d.jpg']) {
    mockFileStore.set(`${DIR}${name}`, 'bytes');
  }
});

describe('deleting an activity previews before the index was built', () => {
  it('removes that activity files and keeps the others', async () => {
    const cache = freshCache();

    await cache.deleteTerrainPreviewsForActivity('a1');

    expect([...mockFileStore.keys()]).toEqual([`${DIR}a2_light_3d.jpg`]);
    expect(cache.hasTerrainPreview('a1', 'light', true)).toBe(false);
    expect(cache.hasTerrainPreview('a1', 'light', false)).toBe(false);
    expect(cache.hasTerrainPreview('a2', 'light', true)).toBe(true);
  });

  it('a delete racing the feed own load leaves one consistent index', async () => {
    const cache = freshCache();

    await Promise.all([
      cache.initTerrainPreviewCache(),
      cache.deleteTerrainPreviewsForActivity('a1'),
    ]);

    expect([...mockFileStore.keys()]).toEqual([`${DIR}a2_light_3d.jpg`]);
    expect(cache.hasTerrainPreview('a1', 'light', true)).toBe(false);
    expect(cache.hasTerrainPreview('a2', 'light', true)).toBe(true);
  });
});
