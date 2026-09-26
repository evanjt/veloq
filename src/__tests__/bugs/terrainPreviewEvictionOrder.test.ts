/**
 * Scenario: the app is restarted, and the preview cache rebuilds its index by
 * listing the directory. The filesystem returns those names in its own order,
 * which is not the order they were written in.
 *
 * Expected behaviour: eviction still takes the oldest preview. The index says
 * it is ordered by insertion and `saveTerrainPreview` evicts by shifting off
 * the front, so an index rebuilt in directory order evicts whatever the
 * filesystem happened to name first, which can be the card on screen.
 */

import {
  saveTerrainPreview,
  hasTerrainPreview,
  initTerrainPreviewCache,
  clearTerrainPreviews,
} from '@/features/maps/lib/storage/terrainPreviewCache';

const MAX_CACHED_PREVIEWS = 150;
const DIR = '/mock/docs/terrain_previews/';

const mockFileStore = new Map<string, string>();
const mockDirStore = new Set<string>([DIR]);
const mockMtimes = new Map<string, number>();
/** What `readDirectoryAsync` hands back, filesystem order rather than write order. */
let mockDirListing: string[] | null = null;

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: '/mock/cache/',
  documentDirectory: '/mock/docs/',
  EncodingType: { Base64: 'base64' },
  getInfoAsync: jest.fn(async (path: string) => ({
    exists: mockDirStore.has(path) || mockFileStore.has(path),
    isDirectory: mockDirStore.has(path),
    size: mockFileStore.get(path)?.length ?? 0,
    modificationTime: mockMtimes.get(path),
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
  readDirectoryAsync: jest.fn(async (path: string) => {
    if (mockDirListing) return mockDirListing;
    return [...mockFileStore.keys()]
      .filter((k) => k.startsWith(path))
      .map((k) => k.slice(path.length));
  }),
}));

const FLAT = false;

/** One preview on disk, written at `writtenAt`, with no index entry for it. */
function seed(activityId: string, writtenAt: number): string {
  const name = `${activityId}_light.jpg`;
  mockFileStore.set(`${DIR}${name}`, 'bytes');
  mockMtimes.set(`${DIR}${name}`, writtenAt);
  return name;
}

describe('eviction takes the oldest preview even after the index is rebuilt from disk', () => {
  beforeEach(async () => {
    await clearTerrainPreviews();
    mockFileStore.clear();
    mockDirStore.clear();
    mockMtimes.clear();
    mockDirListing = null;
    mockDirStore.add(DIR);
    // Settles the stored render version. The first init of a suite finds none
    // and clears the directory, which would take the seeded files with it.
    await initTerrainPreviewCache();
  });

  it('evicts the oldest by write time, not whatever the directory listed first', async () => {
    const names: string[] = [];
    for (let i = 0; i < MAX_CACHED_PREVIEWS; i++) {
      names.push(seed(`a${i}`, 1000 + i));
    }
    // The oldest is a0 and the newest a149. A real directory read returns
    // neither order: this one returns the newest first.
    mockDirListing = [...names].reverse();
    await initTerrainPreviewCache();

    await saveTerrainPreview('newcomer', 'light', FLAT, 'bytes');

    expect(hasTerrainPreview('a0', 'light', FLAT)).toBe(false);
    expect(hasTerrainPreview('a149', 'light', FLAT)).toBe(true);
    expect(hasTerrainPreview('newcomer', 'light', FLAT)).toBe(true);
  });

  it('leaves the order alone when the listing is already oldest first', async () => {
    const names: string[] = [];
    for (let i = 0; i < MAX_CACHED_PREVIEWS; i++) {
      names.push(seed(`b${i}`, 2000 + i));
    }
    mockDirListing = names;
    await initTerrainPreviewCache();

    await saveTerrainPreview('newcomer', 'light', FLAT, 'bytes');

    expect(hasTerrainPreview('b0', 'light', FLAT)).toBe(false);
    expect(hasTerrainPreview('b149', 'light', FLAT)).toBe(true);
  });

  it('keeps every preview indexed when a file has no modification time', async () => {
    const names = [seed('c0', 3000), seed('c1', 3001), seed('c2', 3002)];
    mockMtimes.delete(`${DIR}c1_light.jpg`);
    mockDirListing = names;
    await initTerrainPreviewCache();

    expect(hasTerrainPreview('c0', 'light', FLAT)).toBe(true);
    expect(hasTerrainPreview('c1', 'light', FLAT)).toBe(true);
    expect(hasTerrainPreview('c2', 'light', FLAT)).toBe(true);
  });
});
