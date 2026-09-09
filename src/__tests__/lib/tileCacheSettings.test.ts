/**
 * The tile cache key is no longer a store, only a one-off migration that
 * flattens an older proactive cache mode to ambient. Startup awaits it, so it
 * must resolve on a corrupt value and on a storage that throws.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { migrateTileCacheSettings } from '@/features/maps/lib/storage/tileCacheSettings';

const noop = () => {};
jest.mock('@/shared/debug/debug', () => ({
  debug: { create: () => noop },
}));

const TILE_CACHE_KEY = 'veloq-tile-cache';

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

describe('migrateTileCacheSettings', () => {
  it('writes nothing when no value is stored', async () => {
    await migrateTileCacheSettings();
    expect(await AsyncStorage.getItem(TILE_CACHE_KEY)).toBeNull();
  });

  it('flattens a proactive cache mode to ambient', async () => {
    await AsyncStorage.setItem(
      TILE_CACHE_KEY,
      JSON.stringify({ cacheMode: 'proactive', maxSize: 500 })
    );
    await migrateTileCacheSettings();
    const stored = JSON.parse((await AsyncStorage.getItem(TILE_CACHE_KEY))!);
    expect(stored.cacheMode).toBe('ambient');
    expect(stored.maxSize).toBeUndefined();
  });

  it('leaves an already-ambient value untouched', async () => {
    await AsyncStorage.setItem(
      TILE_CACHE_KEY,
      JSON.stringify({ cacheMode: 'ambient', extra: 'field' })
    );
    await migrateTileCacheSettings();
    const stored = JSON.parse((await AsyncStorage.getItem(TILE_CACHE_KEY))!);
    expect(stored.cacheMode).toBe('ambient');
    expect(stored.extra).toBe('field');
  });

  it('leaves a corrupt value alone rather than throwing', async () => {
    await AsyncStorage.setItem(TILE_CACHE_KEY, 'not valid json');
    await expect(migrateTileCacheSettings()).resolves.toBeUndefined();
    expect(await AsyncStorage.getItem(TILE_CACHE_KEY)).toBe('not valid json');
  });

  it('resolves when the read throws', async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('fail'));
    await expect(migrateTileCacheSettings()).resolves.toBeUndefined();
  });

  it('is safe to run twice', async () => {
    await AsyncStorage.setItem(TILE_CACHE_KEY, JSON.stringify({ cacheMode: 'proactive' }));
    await migrateTileCacheSettings();
    await migrateTileCacheSettings();
    const stored = JSON.parse((await AsyncStorage.getItem(TILE_CACHE_KEY))!);
    expect(stored.cacheMode).toBe('ambient');
  });
});
