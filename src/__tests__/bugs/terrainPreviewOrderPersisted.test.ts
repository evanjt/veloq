/**
 * Scenario: the feed mounts and the preview cache rebuilds its index. Working
 * out the insertion order meant one `getInfoAsync` per cached file, up to 150 of
 * them, because a filename was the only thing the cache kept on disk.
 *
 * Expected behaviour: the order is recorded when the index changes and read
 * back on the next launch, so the stat pass runs only when that record is
 * missing. The files stay the truth about what exists.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  reconcileTerrainOrder,
  saveTerrainPreview,
  initTerrainPreviewCache,
  clearTerrainPreviews,
  hasTerrainPreview,
  TERRAIN_CACHE_VERSION,
  TERRAIN_PREVIEW_VERSION_KEY,
} from '@/features/maps/lib/storage/terrainPreviewCache';

const DIR = '/mock/cache/terrain_previews/';
const ORDER_KEY = 'terrain-preview-order';
const FLAT = false;

const mockFileStore = new Map<string, string>();
const mockDirStore = new Set<string>([DIR]);
/** Every path `getInfoAsync` was asked about, which is the cost being removed. */
let mockStatted: string[] = [];

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: '/mock/cache/',
  EncodingType: { Base64: 'base64' },
  getInfoAsync: jest.fn(async (path: string) => {
    mockStatted.push(path);
    return {
      exists: mockDirStore.has(path) || mockFileStore.has(path),
      isDirectory: mockDirStore.has(path),
      size: 0,
      modificationTime: 1,
    };
  }),
  makeDirectoryAsync: jest.fn(async (path: string) => {
    mockDirStore.add(path);
  }),
  writeAsStringAsync: jest.fn(async (path: string, data: string) => {
    mockFileStore.set(path, data);
  }),
  deleteAsync: jest.fn(async (path: string) => {
    mockFileStore.delete(path);
    mockDirStore.delete(path);
  }),
  readDirectoryAsync: jest.fn(async (path: string) =>
    [...mockFileStore.keys()].filter((k) => k.startsWith(path)).map((k) => k.slice(path.length))
  ),
}));

/** Paths under the preview directory, which is what the stat pass walks. */
const stattedFiles = () => mockStatted.filter((p) => p.startsWith(DIR) && p.endsWith('.jpg'));

beforeEach(async () => {
  mockFileStore.clear();
  mockDirStore.clear();
  mockDirStore.add(DIR);
  mockStatted = [];
  await AsyncStorage.clear();
  await AsyncStorage.setItem(TERRAIN_PREVIEW_VERSION_KEY, String(TERRAIN_CACHE_VERSION));
});

describe('reconciling the stored order against the directory', () => {
  it('keeps the stored order for files that are still there', () => {
    expect(reconcileTerrainOrder(['a', 'b', 'c'], ['c', 'a', 'b'])).toEqual(['a', 'b', 'c']);
  });

  it('drops a key whose file has gone', () => {
    expect(reconcileTerrainOrder(['a', 'b', 'c'], ['a', 'c'])).toEqual(['a', 'c']);
  });

  it('puts a file of unknown age at the front, where eviction takes it first', () => {
    expect(reconcileTerrainOrder(['a', 'b'], ['a', 'b', 'stray'])).toEqual(['stray', 'a', 'b']);
  });

  it('is every file when there is no order to go on', () => {
    expect(reconcileTerrainOrder([], ['a', 'b'])).toEqual(['a', 'b']);
  });

  it('is nothing when the directory is empty, whatever the order said', () => {
    expect(reconcileTerrainOrder(['a', 'b'], [])).toEqual([]);
  });
});

describe('the cache index across a launch', () => {
  it('records the order when a preview is saved', async () => {
    await initTerrainPreviewCache();
    await saveTerrainPreview('a1', 'light', FLAT, 'one');
    await saveTerrainPreview('a2', 'light', FLAT, 'two');

    const stored = JSON.parse((await AsyncStorage.getItem(ORDER_KEY)) ?? 'null');
    expect(stored).toEqual(['a1_light', 'a2_light']);
  });

  it('reads the order back without statting a single file', async () => {
    await initTerrainPreviewCache();
    await saveTerrainPreview('a1', 'light', FLAT, 'one');
    await saveTerrainPreview('a2', 'light', FLAT, 'two');

    mockStatted = [];
    await initTerrainPreviewCache();

    expect(stattedFiles()).toEqual([]);
    expect(hasTerrainPreview('a1', 'light', FLAT)).toBe(true);
    expect(hasTerrainPreview('a2', 'light', FLAT)).toBe(true);
  });

  it('falls back to the write times when no order was recorded', async () => {
    await initTerrainPreviewCache();
    await saveTerrainPreview('a1', 'light', FLAT, 'one');
    await AsyncStorage.removeItem(ORDER_KEY);

    mockStatted = [];
    await initTerrainPreviewCache();

    expect(stattedFiles()).toEqual([`${DIR}a1_light.jpg`]);
    expect(hasTerrainPreview('a1', 'light', FLAT)).toBe(true);
  });

  it('forgets the order when the cache is cleared', async () => {
    await initTerrainPreviewCache();
    await saveTerrainPreview('a1', 'light', FLAT, 'one');

    await clearTerrainPreviews();
    await new Promise(process.nextTick);

    expect(await AsyncStorage.getItem(ORDER_KEY)).toBeNull();
  });

  it('ignores a stored order that is not a list of keys', async () => {
    await initTerrainPreviewCache();
    await saveTerrainPreview('a1', 'light', FLAT, 'one');
    await AsyncStorage.setItem(ORDER_KEY, '{"not":"a list"}');

    mockStatted = [];
    await initTerrainPreviewCache();

    // Back to the write times rather than trusting the shape.
    expect(stattedFiles()).toEqual([`${DIR}a1_light.jpg`]);
    expect(hasTerrainPreview('a1', 'light', FLAT)).toBe(true);
  });
});
