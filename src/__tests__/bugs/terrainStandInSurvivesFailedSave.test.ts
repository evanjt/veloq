/**
 * Scenario: a 3D drape is saved over the flat stand-in the card was already
 * served, and the drape's write fails partway, for example on a full disk.
 *
 * Expected behaviour: the stand-in is still the preview the card holds, on the
 * index and on disk, so the card keeps its image and the next pass still knows
 * the drape is owed. The stand-in is removed only once the drape has landed.
 */

import * as FileSystem from 'expo-file-system/legacy';

import {
  saveTerrainPreview,
  hasTerrainPreview,
  isTerrainPreviewDowngraded,
  initTerrainPreviewCache,
  clearTerrainPreviews,
  getTerrainPreviewUri,
} from '@/features/maps/lib/storage/terrainPreviewCache';

const TERRAIN_DIR = `${FileSystem.documentDirectory}terrain_previews/`;
const mockFileStore = new Map<string, string>();
const mockDirStore = new Set<string>([TERRAIN_DIR]);

jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
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
  readDirectoryAsync: jest.fn(async (path: string) =>
    [...mockFileStore.keys()].filter((k) => k.startsWith(path)).map((k) => k.slice(path.length))
  ),
}));

const DRAPED = true;
const STAND_IN_FILE = `${TERRAIN_DIR}a1_light_3d_flat.jpg`;
const DRAPE_FILE = `${TERRAIN_DIR}a1_light_3d.jpg`;

describe('a drape saved over its flat stand-in', () => {
  beforeEach(async () => {
    await clearTerrainPreviews();
    mockFileStore.clear();
    mockDirStore.clear();
    mockDirStore.add(TERRAIN_DIR);
    await initTerrainPreviewCache();
    await saveTerrainPreview('a1', 'light', DRAPED, 'STANDIN', { downgradedTo: 'flat' });
  });

  it('keeps the stand-in when the drape write fails', async () => {
    (FileSystem.writeAsStringAsync as jest.Mock).mockRejectedValueOnce(new Error('disk full'));

    await expect(saveTerrainPreview('a1', 'light', DRAPED, 'DRAPE')).rejects.toThrow('disk full');

    expect(hasTerrainPreview('a1', 'light', DRAPED)).toBe(true);
    expect(isTerrainPreviewDowngraded('a1', 'light', DRAPED)).toBe(true);
    expect(mockFileStore.get(STAND_IN_FILE)).toBe('STANDIN');
    expect(mockFileStore.has(DRAPE_FILE)).toBe(false);
  });

  it('serves the stand-in afterwards, so the card is not left without an image', async () => {
    (FileSystem.writeAsStringAsync as jest.Mock).mockRejectedValueOnce(new Error('disk full'));
    await expect(saveTerrainPreview('a1', 'light', DRAPED, 'DRAPE')).rejects.toThrow();

    expect(mockFileStore.get(getTerrainPreviewUri('a1', 'light', DRAPED).split('?')[0])).toBe(
      'STANDIN'
    );
  });

  it('removes the stand-in file once the drape has landed', async () => {
    await saveTerrainPreview('a1', 'light', DRAPED, 'DRAPE');

    expect(mockFileStore.get(DRAPE_FILE)).toBe('DRAPE');
    expect(mockFileStore.has(STAND_IN_FILE)).toBe(false);
    expect(isTerrainPreviewDowngraded('a1', 'light', DRAPED)).toBe(false);
  });
});
