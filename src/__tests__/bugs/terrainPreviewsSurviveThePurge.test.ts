/**
 * Scenario: the terrain previews sat under `cacheDirectory`, which both
 * platforms may purge while the app is backgrounded. The feed then mounts with
 * 150 misses and redraws every snapshot through the WebView, which is the most
 * expensive thing the app draws, on the one path that has to be fast.
 *
 * Expected behaviour: they live beside the tile tree under `documentDirectory`,
 * and launch asks for the same backup exclusion the tile tree gets, because a
 * redrawable cache has no business in the athlete's iCloud backup.
 */

import {
  TERRAIN_PREVIEW_DIR,
  discardLegacyTerrainPreviews,
} from '@/shared/storage/terrainPreviewRoot';

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: '/mock/cache/',
  documentDirectory: '/mock/docs/',
  EncodingType: { Base64: 'base64' },
  getInfoAsync: jest.fn(async () => ({ exists: false, isDirectory: false, size: 0 })),
  makeDirectoryAsync: jest.fn(async () => {}),
  readDirectoryAsync: jest.fn(async () => []),
  deleteAsync: jest.fn(async () => {}),
  moveAsync: jest.fn(async () => {}),
  writeAsStringAsync: jest.fn(async () => {}),
}));

describe('where the terrain previews live', () => {
  it('is the documents directory, which the OS does not purge', () => {
    expect(TERRAIN_PREVIEW_DIR).toBe('/mock/docs/terrain_previews/');
  });

  it('clears the old cache root once, since the files redraw', async () => {
    const fs = jest.requireMock('expo-file-system/legacy');
    fs.getInfoAsync.mockResolvedValueOnce({ exists: true, isDirectory: true, size: 0 });

    await discardLegacyTerrainPreviews();

    expect(fs.deleteAsync).toHaveBeenCalledWith('/mock/cache/terrain_previews/', {
      idempotent: true,
    });
  });

  it('leaves a device that never held them alone', async () => {
    const fs = jest.requireMock('expo-file-system/legacy');
    fs.deleteAsync.mockClear();

    await discardLegacyTerrainPreviews();

    expect(fs.deleteAsync).not.toHaveBeenCalled();
  });
});
