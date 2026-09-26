/**
 * Scenario: the preview cache evicts from the front of an index ordered by
 * when each image was written. An athlete sees the same recent activities
 * every day, and those previews were rendered first, so a single scroll into
 * last year's rides pushes the ones on screen out. Each one back costs a full
 * 3D re-render.
 *
 * Expected behaviour: serving a preview is what keeps it, so eviction takes
 * the least recently served rather than the oldest written. A predicate that
 * only asks whether a preview exists moves nothing, or the queue scan that
 * calls it would reorder the whole cache.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  saveTerrainPreview,
  getTerrainPreviewUri,
  hasTerrainPreview,
  initTerrainPreviewCache,
  clearTerrainPreviews,
  TERRAIN_CACHE_VERSION,
  TERRAIN_PREVIEW_VERSION_KEY,
} from '@/features/maps/lib/storage/terrainPreviewCache';

const MAX_CACHED_PREVIEWS = 150;
const DIR = '/mock/cache/terrain_previews/';
const ORDER_KEY = 'terrain-preview-order';
const FLAT = false;

const mockFileStore = new Map<string, string>();
const mockDirStore = new Set<string>([DIR]);

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: '/mock/cache/',
  EncodingType: { Base64: 'base64' },
  getInfoAsync: jest.fn(async (path: string) => ({
    exists: mockDirStore.has(path) || mockFileStore.has(path),
    isDirectory: mockDirStore.has(path),
    size: 0,
    modificationTime: 1,
  })),
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

async function fill(count: number, prefix = 'a') {
  for (let i = 0; i < count; i++) {
    await saveTerrainPreview(`${prefix}${i}`, 'light', FLAT, 'bytes');
  }
}

/**
 * A serve's write is coalesced, so the assertions run the timer out first. The
 * real cost this avoids is one AsyncStorage write per card in a scroll.
 */
async function storedOrder(): Promise<string[]> {
  jest.advanceTimersByTime(2000);
  await Promise.resolve();
  const raw = await AsyncStorage.getItem(ORDER_KEY);
  return raw ? (JSON.parse(raw) as string[]) : [];
}

beforeEach(async () => {
  jest.useFakeTimers();
  await clearTerrainPreviews();
  mockFileStore.clear();
  mockDirStore.clear();
  mockDirStore.add(DIR);
  await AsyncStorage.clear();
  await AsyncStorage.setItem(TERRAIN_PREVIEW_VERSION_KEY, String(TERRAIN_CACHE_VERSION));
  await initTerrainPreviewCache();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('eviction takes the least recently served preview', () => {
  it('holds a scroll of serves back to one write rather than one per card', async () => {
    await fill(4, 'z');
    const before = await storedOrder();

    getTerrainPreviewUri('z0', 'light', FLAT);
    getTerrainPreviewUri('z1', 'light', FLAT);
    getTerrainPreviewUri('z2', 'light', FLAT);

    // Nothing has been written yet: three serves are still one pending write.
    expect(JSON.parse((await AsyncStorage.getItem(ORDER_KEY)) ?? '[]')).toEqual(before);

    jest.advanceTimersByTime(2000);
    await Promise.resolve();

    expect(JSON.parse((await AsyncStorage.getItem(ORDER_KEY)) ?? '[]')).toEqual([
      'z3_light',
      'z0_light',
      'z1_light',
      'z2_light',
    ]);
  });

  it('keeps a preview that was served after it was written', async () => {
    await fill(MAX_CACHED_PREVIEWS);

    getTerrainPreviewUri('a0', 'light', FLAT);
    await saveTerrainPreview('newcomer', 'light', FLAT, 'bytes');

    expect(hasTerrainPreview('a0', 'light', FLAT)).toBe(true);
    expect(hasTerrainPreview('a1', 'light', FLAT)).toBe(false);
  });

  it('serving moves one entry to the back, not every entry it passed', async () => {
    await fill(3, 'b');

    getTerrainPreviewUri('b0', 'light', FLAT);

    expect(await storedOrder()).toEqual(['b1_light', 'b2_light', 'b0_light']);
  });

  it('leaves the order alone when only asked whether a preview exists', async () => {
    await fill(3, 'c');
    const before = await storedOrder();

    hasTerrainPreview('c0', 'light', FLAT);

    expect(await storedOrder()).toEqual(before);
  });

  it('moves nothing for a preview that is not cached', async () => {
    await fill(2, 'd');
    const before = await storedOrder();

    getTerrainPreviewUri('never-rendered', 'light', FLAT);

    expect(await storedOrder()).toEqual(before);
  });

  it('keeps the served order across a restart', async () => {
    await fill(3, 'e');
    getTerrainPreviewUri('e0', 'light', FLAT);
    // The serve's write is coalesced, so a restart inside the window would
    // lose the reorder. This one is after it landed.
    jest.advanceTimersByTime(2000);
    await Promise.resolve();

    await initTerrainPreviewCache();
    await saveTerrainPreview('newcomer', 'light', FLAT, 'bytes');
    await fill(MAX_CACHED_PREVIEWS - 3, 'f');

    expect(hasTerrainPreview('e1', 'light', FLAT)).toBe(false);
    expect(hasTerrainPreview('e0', 'light', FLAT)).toBe(true);
  });

  it('moves the stand-in it actually serves, not the key that was asked for', async () => {
    await fill(3, 'g');
    await saveTerrainPreview('h0', 'light', true, 'bytes', { downgradedTo: 'flat' });

    getTerrainPreviewUri('h0', 'light', true);

    expect((await storedOrder()).at(-1)).toBe('h0_light_3d_flat');
  });
});
