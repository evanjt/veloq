/**
 * Scenario: one activity rendered flat and rendered as a 3D terrain drape.
 * Expected behaviour: the two are two cache entries, so a toggle is a miss
 * under the new key rather than a flag that has to survive the process, and a
 * delete drops the index before it touches the disk, so a request racing it is
 * never dropped against an entry whose file is already gone.
 */

import * as FileSystem from 'expo-file-system/legacy';
import {
  saveTerrainPreview,
  hasTerrainPreview,
  getTerrainPreviewUri,
  deleteTerrainPreviewsForActivity,
  initTerrainPreviewCache,
  clearTerrainPreviews,
} from '@/features/maps/lib/storage/terrainPreviewCache';

const mockFileStore = new Map<string, string>();
const mockDirStore = new Set<string>(['/mock/cache/terrain_previews/']);
let mockDeleteGate: (() => Promise<void>) | null = null;

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
    if (mockDeleteGate) await mockDeleteGate();
    mockFileStore.delete(path);
    mockDirStore.delete(path);
  }),
  readDirectoryAsync: jest.fn(async (path: string) =>
    [...mockFileStore.keys()].filter((k) => k.startsWith(path)).map((k) => k.slice(path.length))
  ),
}));

const FLAT = false;
const DRAPED = true;

describe('terrain preview cache keys the render, not just the style', () => {
  beforeEach(async () => {
    mockDeleteGate = null;
    await clearTerrainPreviews();
    mockFileStore.clear();
    mockDirStore.clear();
    mockDirStore.add('/mock/cache/terrain_previews/');
    await initTerrainPreviewCache();
  });

  it('does not serve a flat render to a card asking for the 3D drape', async () => {
    await saveTerrainPreview('a1', 'light', FLAT, 'flatbytes');

    expect(hasTerrainPreview('a1', 'light', FLAT)).toBe(true);
    expect(hasTerrainPreview('a1', 'light', DRAPED)).toBe(false);
  });

  it('holds the two renders of one activity as two files', async () => {
    await saveTerrainPreview('a1', 'light', FLAT, 'flatbytes');
    await saveTerrainPreview('a1', 'light', DRAPED, 'drapedbytes');

    expect(getTerrainPreviewUri('a1', 'light', FLAT)).not.toBe(
      getTerrainPreviewUri('a1', 'light', DRAPED)
    );
    expect(mockFileStore.get(getTerrainPreviewUri('a1', 'light', FLAT))).toBe('flatbytes');
    expect(mockFileStore.get(getTerrainPreviewUri('a1', 'light', DRAPED))).toBe('drapedbytes');
  });

  it('survives a restart: the toggle is a key, so nothing has to be remembered', async () => {
    await saveTerrainPreview('a1', 'light', FLAT, 'flatbytes');

    await initTerrainPreviewCache();

    expect(hasTerrainPreview('a1', 'light', FLAT)).toBe(true);
    expect(hasTerrainPreview('a1', 'light', DRAPED)).toBe(false);
  });

  it('drops the index entry before it awaits the file removal', async () => {
    await saveTerrainPreview('a1', 'light', FLAT, 'flatbytes');

    let releaseDelete = () => {};
    mockDeleteGate = () => new Promise<void>((resolve) => (releaseDelete = () => resolve()));

    const pending = deleteTerrainPreviewsForActivity('a1');
    await Promise.resolve();

    expect(hasTerrainPreview('a1', 'light', FLAT)).toBe(false);

    releaseDelete();
    await pending;
    expect(mockFileStore.has(getTerrainPreviewUri('a1', 'light', FLAT))).toBe(false);
  });

  it('clears both renders of an activity and leaves its neighbours alone', async () => {
    await saveTerrainPreview('a1', 'light', FLAT, 'flatbytes');
    await saveTerrainPreview('a1', 'light', DRAPED, 'drapedbytes');
    await saveTerrainPreview('a2', 'light', FLAT, 'other');

    await deleteTerrainPreviewsForActivity('a1');

    expect(hasTerrainPreview('a1', 'light', FLAT)).toBe(false);
    expect(hasTerrainPreview('a1', 'light', DRAPED)).toBe(false);
    expect(hasTerrainPreview('a2', 'light', FLAT)).toBe(true);
  });

  it('keeps the file and the index in step when the same key is written twice', async () => {
    await saveTerrainPreview('a1', 'light', DRAPED, 'first');
    await saveTerrainPreview('a1', 'light', DRAPED, 'second');

    expect(mockFileStore.get(getTerrainPreviewUri('a1', 'light', DRAPED))).toBe('second');
    expect(await FileSystem.readDirectoryAsync('/mock/cache/terrain_previews/')).toHaveLength(1);
  });
});
