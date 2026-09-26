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
  isTerrainPreviewDowngraded,
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

  /**
   * A drape that cannot be rendered falls back to a flat stand-in saved under
   * the 3D key with a `flat` downgrade marker. The key the deletion keeps is
   * the undowngraded one, so the stand-in that had just landed was the file it
   * deleted, and the card was left holding a uri to nothing.
   */
  it('keeps a flat stand-in that landed under the 3D key', async () => {
    await saveTerrainPreview('a1', 'satellite', DRAPED, 'standin', { downgradedTo: 'flat' });

    await deleteSupersededTerrainPreviews('a1', 'satellite', DRAPED);

    expect(hasTerrainPreview('a1', 'satellite', DRAPED)).toBe(true);
    expect(isTerrainPreviewDowngraded('a1', 'satellite', DRAPED)).toBe(true);
  });

  /**
   * The stand-in is kept only while it is the render the card is showing. Once
   * the real drape lands the stand-in is not superseded, it is wrong: the save
   * drops it there and then, because leaving it indexed would report the
   * activity as downgraded forever and keep asking for an upgrade it already
   * has. Asserted here so the rule above is not read as the stronger one.
   */
  it('lets the real drape take the stand-in with it', async () => {
    await saveTerrainPreview('a1', 'satellite', DRAPED, 'standin', { downgradedTo: 'flat' });
    await saveTerrainPreview('a1', 'satellite', DRAPED, 'draped');

    await deleteSupersededTerrainPreviews('a1', 'satellite', DRAPED);

    expect(hasTerrainPreview('a1', 'satellite', DRAPED)).toBe(true);
    expect(isTerrainPreviewDowngraded('a1', 'satellite', DRAPED)).toBe(false);
  });

  /** Everything else for that activity still goes. */
  it('still drops the other styles while keeping both 3D keys', async () => {
    await saveTerrainPreview('a1', 'light', FLAT, 'one');
    await saveTerrainPreview('a1', 'satellite', FLAT, 'two');
    await saveTerrainPreview('a1', 'satellite', DRAPED, 'standin', { downgradedTo: 'flat' });
    await saveTerrainPreview('a1', 'satellite', DRAPED, 'draped');

    await deleteSupersededTerrainPreviews('a1', 'satellite', DRAPED);

    expect(hasTerrainPreview('a1', 'light', FLAT)).toBe(false);
    expect(hasTerrainPreview('a1', 'satellite', FLAT)).toBe(false);
    expect(hasTerrainPreview('a1', 'satellite', DRAPED)).toBe(true);
  });

  it('is safe when the render that landed is not cached at all', async () => {
    await saveTerrainPreview('a1', 'light', FLAT, 'one');

    await deleteSupersededTerrainPreviews('a1', 'satellite', DRAPED);

    expect(hasTerrainPreview('a1', 'light', FLAT)).toBe(false);
    expect(hasTerrainPreview('a1', 'satellite', DRAPED)).toBe(false);
  });
});
