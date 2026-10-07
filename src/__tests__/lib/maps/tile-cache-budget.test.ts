/**
 * Scenario: the athlete wants a bigger tile cache so a region survives a trip,
 * and later a smaller one to get the storage back.
 *
 * Expected behaviour: the ceiling snaps onto a ladder and persists across
 * restarts, and the pages drop the Cache API buckets earlier builds filled
 * rather than keep a second copy of the tiles beside the Rust store.
 */

import {
  DEFAULT_TILE_CACHE_BUDGET_MB,
  LEGACY_SATELLITE_CACHE,
  LEGACY_TERRAIN_CACHE,
  TILE_CACHE_BUDGET_CHOICES_MB,
  TILE_CACHE_NAMES,
  clampTileCacheBudgetMb,
  dropRetiredTileCachesScript,
} from '@/features/maps/lib/tileCacheBudget';
import { useTileCacheSettings } from '@/features/maps/lib/storage/tileCacheSettings';

const store: Record<string, string> = {};

jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn(async (key: string) => store[key] ?? null),
  setSetting: jest.fn(async (key: string, value: string) => {
    store[key] = value;
  }),
}));

describe('the budget', () => {
  it('falls back to the default rather than trusting stored junk', () => {
    for (const junk of [undefined, null, 'lots', -50, 0, NaN]) {
      expect(clampTileCacheBudgetMb(junk)).toBe(DEFAULT_TILE_CACHE_BUDGET_MB);
    }
  });

  // One pool for every source, and the athlete can raise it.
  it('starts at the 50 MB the athlete was promised, and climbs from there', () => {
    expect(DEFAULT_TILE_CACHE_BUDGET_MB).toBe(50);
    expect(TILE_CACHE_BUDGET_CHOICES_MB).toEqual([50, 100, 200, 400]);
    expect(clampTileCacheBudgetMb(undefined)).toBe(50);
  });

  // An install carrying the old 200 MB ceiling asked for 200 MB, so it keeps
  // it. One carrying 800, which the ladder no longer offers, comes down to the
  // nearest rung rather than all the way back to the default.
  it('brings a stored ceiling down to the nearest rung, not back to the default', () => {
    expect(clampTileCacheBudgetMb(200)).toBe(200);
    expect(clampTileCacheBudgetMb(800)).toBe(400);
    expect(clampTileCacheBudgetMb(150)).toBe(100);
    expect(clampTileCacheBudgetMb(20)).toBe(50);
  });
});

describe('the buckets earlier builds filled', () => {
  it('are deleted by name when a page loads', () => {
    const deleted: string[] = [];
    const caches = { delete: jest.fn(async (name: string) => deleted.push(name)) };
    new Function('caches', dropRetiredTileCachesScript())(caches);

    expect(deleted.sort()).toEqual(
      [...TILE_CACHE_NAMES, LEGACY_SATELLITE_CACHE, LEGACY_TERRAIN_CACHE].sort()
    );
  });

  it('are left alone by a page with no Cache API, without throwing', () => {
    expect(() => new Function(dropRetiredTileCachesScript())()).not.toThrow();
  });
});

/**
 * The setting is persisted under the key the backup format already carries, so
 * a raised ceiling survives a restart and a restore.
 */
describe('the stored setting', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
    useTileCacheSettings.setState({ budgetMb: DEFAULT_TILE_CACHE_BUDGET_MB, isLoaded: false });
  });

  it('defaults when nothing is stored', async () => {
    await useTileCacheSettings.getState().initialize();
    expect(useTileCacheSettings.getState().budgetMb).toBe(DEFAULT_TILE_CACHE_BUDGET_MB);
  });

  it('survives a restart and keeps the cache mode beside it', async () => {
    store['veloq-tile-cache'] = JSON.stringify({ cacheMode: 'ambient' });
    await useTileCacheSettings.getState().initialize();
    await useTileCacheSettings.getState().setBudgetMb(400);

    const written = JSON.parse(store['veloq-tile-cache']);
    expect(written).toEqual({ cacheMode: 'ambient', budgetMb: 400 });

    useTileCacheSettings.setState({ budgetMb: DEFAULT_TILE_CACHE_BUDGET_MB });
    await useTileCacheSettings.getState().initialize();
    expect(useTileCacheSettings.getState().budgetMb).toBe(400);
  });

  // An install that had raised its ceiling asked for room, so it keeps as much
  // of it as the ladder still offers rather than being scrubbed back to 50 MB.
  it('brings a stored ceiling the ladder no longer offers down one rung', async () => {
    store['veloq-tile-cache'] = JSON.stringify({ budgetMb: 800 });
    await useTileCacheSettings.getState().initialize();
    expect(useTileCacheSettings.getState().budgetMb).toBe(400);
  });

  it('takes the default for a stored value that was never a ceiling', async () => {
    store['veloq-tile-cache'] = JSON.stringify({ budgetMb: 'lots' });
    await useTileCacheSettings.getState().initialize();
    expect(useTileCacheSettings.getState().budgetMb).toBe(DEFAULT_TILE_CACHE_BUDGET_MB);
  });
});
