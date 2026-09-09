/**
 * Scenario: an athlete who experiments with one card's map style and 3D mode.
 * Every render they have tried stays on disk under its own key.
 *
 * Expected behaviour: once the render they asked for has landed, the ones it
 * supersedes go. Landed first, deleted after, so a failed re-render never
 * leaves the card with nothing. Other activities are never touched.
 */

import {
  saveTerrainPreview,
  hasTerrainPreview,
  deleteSupersededTerrainPreviews,
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

describe('a superseded preview is deleted once its replacement has landed', () => {
  beforeEach(async () => {
    await clearTerrainPreviews();
    mockFileStore.clear();
    mockDirStore.clear();
    mockDirStore.add('/mock/cache/terrain_previews/');
    await initTerrainPreviewCache();
  });

  it('keeps the render that landed and drops the rest for that activity', async () => {
    await saveTerrainPreview('a1', 'light', FLAT, 'one');
    await saveTerrainPreview('a1', 'satellite', FLAT, 'two');
    await saveTerrainPreview('a1', 'satellite', DRAPED, 'three');

    await deleteSupersededTerrainPreviews('a1', 'satellite', DRAPED);

    expect(hasTerrainPreview('a1', 'satellite', DRAPED)).toBe(true);
    expect(hasTerrainPreview('a1', 'satellite', FLAT)).toBe(false);
    expect(hasTerrainPreview('a1', 'light', FLAT)).toBe(false);
  });

  it('never touches another activity', async () => {
    await saveTerrainPreview('a1', 'light', FLAT, 'one');
    await saveTerrainPreview('a2', 'light', FLAT, 'two');

    await deleteSupersededTerrainPreviews('a1', 'satellite', DRAPED);

    expect(hasTerrainPreview('a2', 'light', FLAT)).toBe(true);
  });

  it('does nothing when the activity has only the render that landed', async () => {
    await saveTerrainPreview('a1', 'light', FLAT, 'one');

    await deleteSupersededTerrainPreviews('a1', 'light', FLAT);

    expect(hasTerrainPreview('a1', 'light', FLAT)).toBe(true);
  });

  it('is safe when the render that landed is not cached at all', async () => {
    await saveTerrainPreview('a1', 'light', FLAT, 'one');

    await deleteSupersededTerrainPreviews('a1', 'satellite', DRAPED);

    expect(hasTerrainPreview('a1', 'light', FLAT)).toBe(false);
    expect(hasTerrainPreview('a1', 'satellite', DRAPED)).toBe(false);
  });
});
