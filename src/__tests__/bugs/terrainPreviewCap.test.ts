/**
 * Scenario: two saves finish close together while the cache holds its cap, or
 * a launch finds more files on disk than the cap.
 *
 * Expected behaviour: the index and the directory both settle at the cap.
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
  ...jest.requireActual('expo-file-system/legacy'),
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
  moveAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
    const data = mockFileStore.get(from);
    if (data === undefined) throw new Error(`no file at ${from}`);
    mockFileStore.delete(from);
    mockFileStore.set(to, data);
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

function seed(activityId: string, writtenAt: number): string {
  const name = `${activityId}_light.jpg`;
  mockFileStore.set(`${DIR}${name}`, 'bytes');
  mockMtimes.set(`${DIR}${name}`, writtenAt);
  return name;
}

const jpgCount = () => [...mockFileStore.keys()].filter((k) => k.endsWith('.jpg')).length;

describe('the preview cache never settles above its cap', () => {
  beforeEach(async () => {
    await clearTerrainPreviews();
    mockFileStore.clear();
    mockDirStore.clear();
    mockMtimes.clear();
    mockDirListing = null;
    mockDirStore.add(DIR);
    await initTerrainPreviewCache();
  });

  it('keeps the cap when two saves start together at the cap', async () => {
    const names: string[] = [];
    for (let i = 0; i < MAX_CACHED_PREVIEWS; i++) names.push(seed(`a${i}`, 1000 + i));
    mockDirListing = names;
    await initTerrainPreviewCache();
    mockDirListing = null;

    await Promise.all([
      saveTerrainPreview('n1', 'light', FLAT, 'bytes'),
      saveTerrainPreview('n2', 'light', FLAT, 'bytes'),
    ]);

    expect(jpgCount()).toBe(MAX_CACHED_PREVIEWS);
    expect(hasTerrainPreview('a0', 'light', FLAT)).toBe(false);
    expect(hasTerrainPreview('a1', 'light', FLAT)).toBe(false);
    expect(hasTerrainPreview('n1', 'light', FLAT)).toBe(true);
    expect(hasTerrainPreview('n2', 'light', FLAT)).toBe(true);
  });

  it('trims an index found above the cap at launch, coldest first', async () => {
    const names: string[] = [];
    for (let i = 0; i < MAX_CACHED_PREVIEWS + 2; i++) names.push(seed(`b${i}`, 2000 + i));
    mockDirListing = names;
    await initTerrainPreviewCache();
    mockDirListing = null;

    expect(jpgCount()).toBe(MAX_CACHED_PREVIEWS);
    expect(hasTerrainPreview('b0', 'light', FLAT)).toBe(false);
    expect(hasTerrainPreview('b1', 'light', FLAT)).toBe(false);
    expect(hasTerrainPreview('b151', 'light', FLAT)).toBe(true);
  });
});
