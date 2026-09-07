/**
 * Scenario: the 3D drape could not be rendered, so the pool drew the flat
 * basemap instead and the card has an image rather than a spinner.
 *
 * Expected behaviour: that image satisfies the card, so nothing re-requests it
 * on every scroll, and it is still recorded as a downgrade so a later pass can
 * draw the drape the athlete actually asked for. The index is rebuilt on launch
 * by listing the directory, so the only place the fact can live is the
 * filename.
 */

import {
  saveTerrainPreview,
  hasTerrainPreview,
  getTerrainPreviewUri,
  isTerrainPreviewDowngraded,
  initTerrainPreviewCache,
  clearTerrainPreviews,
} from '@/features/maps/lib/storage/terrainPreviewCache';

const mockFileStore = new Map<string, string>();
const mockDirStore = new Set<string>(['/mock/cache/terrain_previews/']);

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: '/mock/cache/',
  EncodingType: { Base64: 'base64' },
  getInfoAsync: jest.fn(async (path: string) => ({
    exists: mockDirStore.has(path) || mockFileStore.has(path),
    isDirectory: mockDirStore.has(path),
    size: mockFileStore.get(path)?.length ?? 0,
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

const FLAT = false;
const DRAPED = true;

describe('a preview that fell back to flat records what it was asked for', () => {
  beforeEach(async () => {
    await clearTerrainPreviews();
    mockFileStore.clear();
    mockDirStore.clear();
    mockDirStore.add('/mock/cache/terrain_previews/');
    await initTerrainPreviewCache();
  });

  it('answers a card asking for the drape, so it is not re-requested forever', async () => {
    await saveTerrainPreview('a1', 'light', DRAPED, 'AAAA', { downgradedTo: 'flat' });

    expect(hasTerrainPreview('a1', 'light', DRAPED)).toBe(true);
  });

  it('is still a downgrade after the index is rebuilt from the directory alone', async () => {
    await saveTerrainPreview('a1', 'light', DRAPED, 'AAAA', { downgradedTo: 'flat' });

    await initTerrainPreviewCache();

    expect(isTerrainPreviewDowngraded('a1', 'light', DRAPED)).toBe(true);
  });

  it('does not call a render the athlete chose flat a downgrade', async () => {
    await saveTerrainPreview('a2', 'light', FLAT, 'AAAA');

    await initTerrainPreviewCache();

    expect(hasTerrainPreview('a2', 'light', FLAT)).toBe(true);
    expect(isTerrainPreviewDowngraded('a2', 'light', FLAT)).toBe(false);
  });

  it('does not call a drape that rendered a downgrade', async () => {
    await saveTerrainPreview('a3', 'light', DRAPED, 'AAAA');

    await initTerrainPreviewCache();

    expect(isTerrainPreviewDowngraded('a3', 'light', DRAPED)).toBe(false);
  });

  it('serves the downgraded file to the card that asked for the drape', async () => {
    await saveTerrainPreview('a4', 'light', DRAPED, 'AAAA', { downgradedTo: 'flat' });

    const uri = getTerrainPreviewUri('a4', 'light', DRAPED);

    expect(mockFileStore.has(uri)).toBe(true);
  });

  it('prefers the real drape once it has been drawn', async () => {
    await saveTerrainPreview('a5', 'light', DRAPED, 'AAAA', { downgradedTo: 'flat' });
    await saveTerrainPreview('a5', 'light', DRAPED, 'BBBB');

    expect(isTerrainPreviewDowngraded('a5', 'light', DRAPED)).toBe(false);
    expect(mockFileStore.get(getTerrainPreviewUri('a5', 'light', DRAPED))).toBe('BBBB');
  });

  it('keeps a downgrade for one style clear of another style', async () => {
    await saveTerrainPreview('a6', 'light', DRAPED, 'AAAA', { downgradedTo: 'flat' });

    expect(isTerrainPreviewDowngraded('a6', 'dark', DRAPED)).toBe(false);
    expect(hasTerrainPreview('a6', 'dark', DRAPED)).toBe(false);
  });
});
