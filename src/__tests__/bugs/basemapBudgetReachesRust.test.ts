/**
 * Scenario: the athlete sets the map tile limit, and on both handsets every
 * kept tile lives in the Rust store. The setting reached only the page-side
 * buckets, which hold nothing there, so the store grew without bound whatever
 * the limit said.
 *
 * Expected behaviour: loading the setting and every change to it hand the
 * store the clamped ceiling in bytes.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { useTileCacheSettings } from '@/features/maps/lib/storage/tileCacheSettings';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

const TILE_CACHE_KEY = 'veloq-tile-cache';
const MB = 1_000_000;

function basemap() {
  return jest.requireMock('veloqrs').basemapStore();
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

describe('the tile limit reaches the Rust store', () => {
  it('hands over a changed limit, clamped onto the ladder, in bytes', async () => {
    await useTileCacheSettings.getState().setBudgetMb(120);

    expect(basemap().setBudget).toHaveBeenCalledTimes(1);
    expect(basemap().setBudget).toHaveBeenCalledWith(100 * MB);
  });

  it('hands over the stored limit when the setting loads', async () => {
    await AsyncStorage.setItem(TILE_CACHE_KEY, JSON.stringify({ budgetMb: 400 }));

    await useTileCacheSettings.getState().initialize();

    expect(basemap().setBudget).toHaveBeenLastCalledWith(400 * MB);
  });

  it('hands over the default when nothing is stored', async () => {
    await useTileCacheSettings.getState().initialize();

    expect(basemap().setBudget).toHaveBeenLastCalledWith(50 * MB);
  });

  it('keeps the setting when the store refuses it', async () => {
    basemap().setBudget.mockImplementationOnce(() => Promise.reject(new Error('store closed')));

    await expect(useTileCacheSettings.getState().setBudgetMb(200)).resolves.toBeUndefined();

    expect(useTileCacheSettings.getState().budgetMb).toBe(200);
    expect(JSON.parse((await AsyncStorage.getItem(TILE_CACHE_KEY))!).budgetMb).toBe(200);
  });
});
