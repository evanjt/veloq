/**
 * Loading the tile cache key: the ceiling, and a one-off migration that
 * flattens an older proactive cache mode to ambient. Startup and a restore
 * both await it, so it must resolve on a corrupt value and on a storage that
 * throws.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  getTileCacheBudgetMb,
  initializeTileCacheSettings,
} from '@/features/maps/lib/storage/tileCacheSettings';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

const noop = () => {};
jest.mock('@/shared/debug/debug', () => ({
  debug: { create: () => ({ warn: noop, log: noop, error: noop }) },
}));

const TILE_CACHE_KEY = 'veloq-tile-cache';

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

describe('initializeTileCacheSettings', () => {
  it('writes nothing when no value is stored', async () => {
    await initializeTileCacheSettings();
    expect(await AsyncStorage.getItem(TILE_CACHE_KEY)).toBeNull();
  });

  it('flattens a proactive cache mode to ambient', async () => {
    await AsyncStorage.setItem(
      TILE_CACHE_KEY,
      JSON.stringify({ cacheMode: 'proactive', maxSize: 500 })
    );
    await initializeTileCacheSettings();
    const stored = JSON.parse((await AsyncStorage.getItem(TILE_CACHE_KEY))!);
    expect(stored.cacheMode).toBe('ambient');
    expect(stored.maxSize).toBeUndefined();
  });

  it('leaves an already-ambient value untouched', async () => {
    await AsyncStorage.setItem(
      TILE_CACHE_KEY,
      JSON.stringify({ cacheMode: 'ambient', extra: 'field' })
    );
    await initializeTileCacheSettings();
    const stored = JSON.parse((await AsyncStorage.getItem(TILE_CACHE_KEY))!);
    expect(stored.cacheMode).toBe('ambient');
    expect(stored.extra).toBe('field');
  });

  it('leaves a corrupt value alone rather than throwing, and takes the default', async () => {
    await AsyncStorage.setItem(TILE_CACHE_KEY, 'not valid json');
    await expect(initializeTileCacheSettings()).resolves.toBeUndefined();
    expect(await AsyncStorage.getItem(TILE_CACHE_KEY)).toBe('not valid json');
    expect(getTileCacheBudgetMb()).toBe(50);
  });

  it('resolves when the read throws', async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('fail'));
    await expect(initializeTileCacheSettings()).resolves.toBeUndefined();
  });

  it('is safe to run twice', async () => {
    await AsyncStorage.setItem(TILE_CACHE_KEY, JSON.stringify({ cacheMode: 'proactive' }));
    await initializeTileCacheSettings();
    await initializeTileCacheSettings();
    const stored = JSON.parse((await AsyncStorage.getItem(TILE_CACHE_KEY))!);
    expect(stored.cacheMode).toBe('ambient');
  });

  it('loads a stored ceiling, snapped onto the ladder', async () => {
    await AsyncStorage.setItem(TILE_CACHE_KEY, JSON.stringify({ budgetMb: 250 }));
    await initializeTileCacheSettings();
    expect(getTileCacheBudgetMb()).toBe(200);
  });
});
