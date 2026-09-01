/**
 * Tests for the FileSystem cleanup helpers. GPS data itself lives in Rust SQLite.
 */

// In-memory file system for testing - prefixed with "mock" for jest.mock scope rules
import { clearAllGpsTracks, clearBoundsCache, deleteGpsTracks } from '@/shared/storage/gpsStorage';

const mockFileStore = new Map<string, string>();
const mockDirStore = new Set<string>();

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: '/mock/docs/',
  getInfoAsync: jest.fn(async (path: string) => {
    if (mockDirStore.has(path) || mockFileStore.has(path)) {
      const size = mockFileStore.has(path) ? mockFileStore.get(path)!.length : 0;
      return { exists: true, isDirectory: mockDirStore.has(path), size };
    }
    return { exists: false, isDirectory: false };
  }),
  makeDirectoryAsync: jest.fn(async (path: string) => {
    mockDirStore.add(path);
  }),
  writeAsStringAsync: jest.fn(async (path: string, data: string) => {
    mockFileStore.set(path, data);
  }),
  readAsStringAsync: jest.fn(async (path: string) => {
    if (mockFileStore.has(path)) return mockFileStore.get(path)!;
    throw new Error('File not found');
  }),
  deleteAsync: jest.fn(async (path: string) => {
    for (const key of [...mockFileStore.keys()]) {
      if (key === path || key.startsWith(path)) mockFileStore.delete(key);
    }
    mockDirStore.delete(path);
  }),
  readDirectoryAsync: jest.fn(async (path: string) => {
    const files: string[] = [];
    for (const key of mockFileStore.keys()) {
      if (key.startsWith(path) && key !== path) {
        const rel = key.slice(path.length);
        if (!rel.includes('/')) files.push(rel);
      }
    }
    return files;
  }),
}));

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(() => null),
}));

beforeEach(() => {
  mockFileStore.clear();
  mockDirStore.clear();
});

describe('clearAllGpsTracks', () => {
  it('clears legacy GPS directory', async () => {
    mockDirStore.add('/mock/docs/gps_tracks/');
    mockFileStore.set('/mock/docs/gps_tracks/act1.json', '[]');
    await clearAllGpsTracks();
    expect(mockFileStore.has('/mock/docs/gps_tracks/act1.json')).toBe(false);
  });

  it('does not throw when directory does not exist', async () => {
    await expect(clearAllGpsTracks()).resolves.not.toThrow();
  });
});

describe('deleteGpsTracks', () => {
  it('deletes specified track files', async () => {
    mockFileStore.set('/mock/docs/gps_tracks/act1.json', '[]');
    mockFileStore.set('/mock/docs/gps_tracks/act2.json', '[]');
    await deleteGpsTracks(['act1']);
    expect(mockFileStore.has('/mock/docs/gps_tracks/act1.json')).toBe(false);
    expect(mockFileStore.has('/mock/docs/gps_tracks/act2.json')).toBe(true);
  });

  it('handles empty array', async () => {
    await expect(deleteGpsTracks([])).resolves.not.toThrow();
  });
});

describe('clearBoundsCache', () => {
  it('removes the bounds file', async () => {
    mockDirStore.add('/mock/docs/bounds_cache/');
    mockFileStore.set('/mock/docs/bounds_cache/bounds.json', '{}');
    await clearBoundsCache();
    expect(mockFileStore.has('/mock/docs/bounds_cache/bounds.json')).toBe(false);
  });

  it('does not throw when the file is absent', async () => {
    await expect(clearBoundsCache()).resolves.not.toThrow();
  });
});
