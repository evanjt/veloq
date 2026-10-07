/**
 * Scenario: a cached preview on disk that the card cannot show, because a save
 * was cut off part way or the file went bad after it landed, and a directory
 * the cache has to make again after clearing it.
 *
 * Expected behaviour: a save that did not finish leaves nothing the next launch
 * indexes, a single broken render can be dropped without taking the activity's
 * other renders with it, and every directory the cache makes is kept out of the
 * device backup.
 */

import {
  clearTerrainPreviews,
  deleteTerrainPreview,
  hasTerrainPreview,
  initTerrainPreviewCache,
  saveTerrainPreview,
} from '@/features/maps/lib/storage/terrainPreviewCache';
import { excludeFromBackup } from '@/shared/native/backupExclusion';

const DIR = '/mock/documents/terrain_previews/';
const mockFileStore = new Map<string, string>();
const mockDirStore = new Set<string>([DIR]);
let mockCutWriteShort = false;
let mockHoldWrite: Promise<void> | null = null;

jest.mock('@/shared/native/backupExclusion', () => ({
  excludeFromBackup: jest.fn(() => true),
}));

jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  documentDirectory: 'file:///mock/documents/',
  cacheDirectory: 'file:///mock/cache/',
  EncodingType: { Base64: 'base64' },
  getInfoAsync: jest.fn(async (path: string) => {
    const p = path.replace('file://', '');
    return {
      exists: mockDirStore.has(p) || mockFileStore.has(p),
      isDirectory: mockDirStore.has(p),
    };
  }),
  makeDirectoryAsync: jest.fn(async (path: string) => {
    mockDirStore.add(path.replace('file://', ''));
  }),
  writeAsStringAsync: jest.fn(async (path: string, data: string) => {
    const p = path.replace('file://', '');
    if (mockCutWriteShort) {
      mockFileStore.set(p, data.slice(0, 2));
      throw new Error('disk full');
    }
    mockFileStore.set(p, data);
    if (mockHoldWrite) await mockHoldWrite;
  }),
  moveAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
    const f = from.replace('file://', '');
    const data = mockFileStore.get(f);
    if (data === undefined) throw new Error(`no file at ${from}`);
    mockFileStore.delete(f);
    mockFileStore.set(to.replace('file://', ''), data);
  }),
  deleteAsync: jest.fn(async (path: string) => {
    const p = path.replace('file://', '');
    mockFileStore.delete(p);
    mockDirStore.delete(p);
    for (const k of [...mockFileStore.keys()]) if (k.startsWith(p)) mockFileStore.delete(k);
  }),
  readDirectoryAsync: jest.fn(async (path: string) => {
    const p = path.replace('file://', '');
    return [...mockFileStore.keys()].filter((k) => k.startsWith(p)).map((k) => k.slice(p.length));
  }),
}));

const FLAT = false;
const DRAPED = true;

beforeEach(async () => {
  mockCutWriteShort = false;
  mockHoldWrite = null;
  await clearTerrainPreviews();
  mockFileStore.clear();
  mockDirStore.clear();
  mockDirStore.add(DIR);
  await initTerrainPreviewCache();
  jest.mocked(excludeFromBackup).mockClear();
});

describe('a save cut off part way', () => {
  it('leaves nothing the next launch indexes', async () => {
    mockCutWriteShort = true;

    await expect(saveTerrainPreview('a1', 'light', FLAT, 'AAAAAAAA')).rejects.toThrow();
    await initTerrainPreviewCache();

    expect(hasTerrainPreview('a1', 'light', FLAT)).toBe(false);
    expect(mockFileStore.has(`${DIR}a1_light.jpg`)).toBe(false);
  });

  it('clears the half-written file on the next launch', async () => {
    mockCutWriteShort = true;
    await expect(saveTerrainPreview('a1', 'light', FLAT, 'AAAAAAAA')).rejects.toThrow();

    await initTerrainPreviewCache();

    expect([...mockFileStore.keys()].filter((k) => k.startsWith(DIR))).toEqual([]);
  });

  it('lands the whole file under its key when the write completes', async () => {
    await saveTerrainPreview('a1', 'light', FLAT, 'AAAAAAAA');

    expect(mockFileStore.get(`${DIR}a1_light.jpg`)).toBe('AAAAAAAA');
    expect([...mockFileStore.keys()]).toEqual([`${DIR}a1_light.jpg`]);
  });

  it('keeps the file of a save still being written when the feed reloads the index', async () => {
    let release = () => {};
    mockHoldWrite = new Promise((resolve) => {
      release = resolve;
    });
    const saving = saveTerrainPreview('a1', 'light', FLAT, 'AAAAAAAA');
    await Promise.resolve();

    await initTerrainPreviewCache();
    release();
    await saving;

    expect(mockFileStore.get(`${DIR}a1_light.jpg`)).toBe('AAAAAAAA');
    expect(hasTerrainPreview('a1', 'light', FLAT)).toBe(true);
  });
});

describe('dropping one broken render', () => {
  it('drops that render and keeps the activity’s others', async () => {
    await saveTerrainPreview('a1', 'light', FLAT, 'AAAA');
    await saveTerrainPreview('a1', 'light', DRAPED, 'BBBB');
    await saveTerrainPreview('a1', 'satellite', DRAPED, 'CCCC');
    await saveTerrainPreview('a2', 'light', DRAPED, 'DDDD');

    await deleteTerrainPreview('a1', 'light', DRAPED);

    expect(hasTerrainPreview('a1', 'light', DRAPED)).toBe(false);
    expect(mockFileStore.has(`${DIR}a1_light_3d.jpg`)).toBe(false);
    expect(hasTerrainPreview('a1', 'light', FLAT)).toBe(true);
    expect(hasTerrainPreview('a1', 'satellite', DRAPED)).toBe(true);
    expect(hasTerrainPreview('a2', 'light', DRAPED)).toBe(true);
  });

  it('drops a flat stand-in served for the drape, since that is what the card showed', async () => {
    await saveTerrainPreview('a1', 'light', DRAPED, 'AAAA', { downgradedTo: 'flat' });

    await deleteTerrainPreview('a1', 'light', DRAPED);

    expect(hasTerrainPreview('a1', 'light', DRAPED)).toBe(false);
    expect(mockFileStore.has(`${DIR}a1_light_3d_flat.jpg`)).toBe(false);
  });

  it('stays dropped after the index is rebuilt from the directory', async () => {
    await saveTerrainPreview('a1', 'light', FLAT, 'AAAA');

    await deleteTerrainPreview('a1', 'light', FLAT);
    await initTerrainPreviewCache();

    expect(hasTerrainPreview('a1', 'light', FLAT)).toBe(false);
  });

  it('is a no-op for a render that is not cached', async () => {
    await saveTerrainPreview('a1', 'light', FLAT, 'AAAA');

    await deleteTerrainPreview('a1', 'dark', FLAT);

    expect(hasTerrainPreview('a1', 'light', FLAT)).toBe(true);
  });
});

describe('a directory the cache makes again', () => {
  it('is kept out of the backup when a save remakes it after a clear', async () => {
    await clearTerrainPreviews();
    expect(mockDirStore.has(DIR)).toBe(false);

    await saveTerrainPreview('a1', 'light', FLAT, 'AAAA');

    expect(excludeFromBackup).toHaveBeenCalledWith(DIR);
  });

  it('is kept out of the backup when the first launch clears and remakes it', async () => {
    await clearTerrainPreviews();

    await initTerrainPreviewCache();

    expect(mockDirStore.has(DIR)).toBe(true);
    expect(excludeFromBackup).toHaveBeenCalledWith(DIR);
  });
});
