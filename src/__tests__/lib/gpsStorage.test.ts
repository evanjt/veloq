/**
 * Tests for GPS storage utilities.
 * Mocks expo-file-system for deterministic file operations.
 */

// In-memory file system for testing — prefixed with "mock" for jest.mock scope rules
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

jest.mock('@/lib/native/routeEngine', () => ({
  getRouteEngine: jest.fn(() => null),
}));

import {
  storeGpsTrack,
  getGpsTrack,
  hasGpsTrack,
  clearAllGpsTracks,
  storeOldestDate,
  loadOldestDate,
  storeCheckpoint,
  loadCheckpoint,
  clearCheckpoint,
  storeBoundsCache,
  loadBoundsCache,
  clearBoundsCache,
  getRouteDisplayName,
  saveCustomRouteName,
  loadCustomRouteNames,
} from '@/lib/storage/gpsStorage';

beforeEach(() => {
  mockFileStore.clear();
  mockDirStore.clear();
});

describe('GPS track storage', () => {
  const sampleTrack: [number, number][] = [
    [48.856, 2.352],
    [48.857, 2.353],
    [48.858, 2.354],
  ];

  it('stores and retrieves a GPS track', async () => {
    await storeGpsTrack('act1', sampleTrack);
    const result = await getGpsTrack('act1');
    expect(result).toEqual(sampleTrack);
  });

  it('returns null for non-existent track', async () => {
    const result = await getGpsTrack('nonexistent');
    expect(result).toBeNull();
  });

  it('checks track existence', async () => {
    expect(await hasGpsTrack('act1')).toBe(false);
    await storeGpsTrack('act1', sampleTrack);
    expect(await hasGpsTrack('act1')).toBe(true);
  });

  it('clears all GPS tracks', async () => {
    await storeGpsTrack('act1', sampleTrack);
    await storeGpsTrack('act2', sampleTrack);
    await clearAllGpsTracks();
    expect(await hasGpsTrack('act1')).toBe(false);
    expect(await hasGpsTrack('act2')).toBe(false);
  });

  it('sanitizes activity IDs for filenames', async () => {
    await storeGpsTrack('act/with:special', sampleTrack);
    // Should not throw — ID is sanitized
    const result = await getGpsTrack('act/with:special');
    expect(result).toEqual(sampleTrack);
  });
});

describe('oldest date storage', () => {
  it('stores and loads oldest date', async () => {
    await storeOldestDate('2020-01-15');
    const result = await loadOldestDate();
    expect(result).toBe('2020-01-15');
  });

  it('returns null when no date stored', async () => {
    const result = await loadOldestDate();
    expect(result).toBeNull();
  });
});

describe('checkpoint storage', () => {
  it('stores and loads checkpoint', async () => {
    const checkpoint = { cursor: 'abc', page: 5 };
    await storeCheckpoint(checkpoint);
    const result = await loadCheckpoint();
    expect(result).toEqual(checkpoint);
  });

  it('clears checkpoint', async () => {
    await storeCheckpoint({ data: true });
    await clearCheckpoint();
    const result = await loadCheckpoint();
    expect(result).toBeNull();
  });

  it('returns null when no checkpoint exists', async () => {
    const result = await loadCheckpoint();
    expect(result).toBeNull();
  });
});

describe('bounds cache storage', () => {
  it('stores and loads bounds cache', async () => {
    const cache = { act1: { bounds: [1, 2, 3, 4] } };
    await storeBoundsCache(cache);
    const result = await loadBoundsCache();
    expect(result).toEqual(cache);
  });

  it('clears bounds cache', async () => {
    await storeBoundsCache({ data: true });
    await clearBoundsCache();
    const result = await loadBoundsCache();
    expect(result).toBeNull();
  });
});

describe('custom route names', () => {
  it('saves and loads custom route name', async () => {
    await saveCustomRouteName('route1', 'My Favorite Route');
    const names = await loadCustomRouteNames();
    expect(names['route1']).toBe('My Favorite Route');
  });

  it('returns empty object when no names saved', async () => {
    const names = await loadCustomRouteNames();
    expect(names).toEqual({});
  });
});

describe('getRouteDisplayName', () => {
  it('returns custom name when available', () => {
    const name = getRouteDisplayName({ id: 'r1', name: 'Auto Name' }, { r1: 'Custom' });
    expect(name).toBe('Custom');
  });

  it('returns route.name when no custom name', () => {
    const name = getRouteDisplayName({ id: 'r1', name: 'Auto Name' }, {});
    expect(name).toBe('Auto Name');
  });

  it('returns fallback when no names at all', () => {
    const name = getRouteDisplayName({ id: 'r1' }, {});
    expect(name).toBe('Unnamed Route');
  });
});
