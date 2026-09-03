/**
 * Scenario: the athlete wants a bigger tile cache so a region survives a trip,
 * and later a smaller one to get the storage back.
 *
 * Expected behaviour: one budget, read by both pages that write to the three
 * shared caches, persisted across restarts, and enforced the moment it is
 * lowered rather than at the next fiftieth tile.
 */

import {
  DEFAULT_TILE_CACHE_BUDGET_MB,
  TILE_CACHE_BUDGET_CHOICES_MB,
  TILE_CACHE_NAMES,
  applyTileCacheBudgetScript,
  cacheEvictionScript,
  clampTileCacheBudgetMb,
  tileCacheBudgets,
} from '@/features/maps/lib/tileCacheBudget';
import { tileProtocolsScript } from '@/features/maps/lib/htmlBuilders/shared';
import { onTileCacheBudget } from '@/features/maps/lib/terrainSnapshotEvents';
import { useTileCacheSettings } from '@/features/maps/lib/storage/tileCacheSettings';
import { buildSnapshotWorkerHtml } from '@/features/maps/lib/htmlBuilders/snapshotWorker';

const MB = 1024 * 1024;

const store: Record<string, string> = {};

jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn(async (key: string) => store[key] ?? null),
  setSetting: jest.fn(async (key: string, value: string) => {
    store[key] = value;
  }),
}));

describe('the budget', () => {
  // 110/50/30/10, the 120/50/30 that shipped with the ground raster's 10 MB
  // taken from satellite, which is the only share large enough to give it up.
  it('defaults to the shipped split, with the ground raster carved off satellite', () => {
    expect(DEFAULT_TILE_CACHE_BUDGET_MB).toBe(200);
    const budgets = tileCacheBudgets(DEFAULT_TILE_CACHE_BUDGET_MB);
    expect(budgets['veloq-satellite-v1']).toBe(110 * MB);
    expect(budgets['veloq-vector-v1']).toBe(50 * MB);
    expect(budgets['veloq-terrain-dem-v1']).toBe(30 * MB);
    expect(budgets['veloq-ground-v1']).toBe(10 * MB);
  });

  it('scales every cache and always sums to the total', () => {
    for (const mb of TILE_CACHE_BUDGET_CHOICES_MB) {
      const budgets = tileCacheBudgets(mb);
      const sum = TILE_CACHE_NAMES.reduce((n, name) => n + budgets[name], 0);
      expect(sum).toBe(mb * MB);
    }
  });

  it('falls back to the default rather than trusting stored junk', () => {
    for (const junk of [undefined, null, 'lots', -50, 0, 12345, NaN]) {
      expect(clampTileCacheBudgetMb(junk)).toBe(DEFAULT_TILE_CACHE_BUDGET_MB);
    }
  });
});

describe('both pages read the one budget', () => {
  it('carries the same eviction script and registers it once each', () => {
    const snippet = cacheEvictionScript();
    expect(tileProtocolsScript()).toContain(snippet);
    expect(buildSnapshotWorkerHtml(0)).toContain(snippet);
    for (const page of [tileProtocolsScript(), buildSnapshotWorkerHtml(0)]) {
      expect(page.split('var CACHE_BUDGETS').length - 1).toBe(1);
      expect(page).not.toContain('120 * 1024 * 1024');
    }
  });

  it('builds both pages at whatever the setting says', () => {
    const raised = cacheEvictionScript(800);
    expect(tileProtocolsScript({ tileCacheBudgetMb: 800 })).toContain(raised);
    expect(buildSnapshotWorkerHtml(0, 800)).toContain(raised);
  });
});

describe('lowering the budget', () => {
  type CacheStub = { keys: jest.Mock; match: jest.Mock; delete: jest.Mock };

  function runPage(script: string): { cache: CacheStub; win: Record<string, unknown> } {
    const entries = Array.from({ length: 10 }, (_, i) => `tile-${i}`);
    const cache: CacheStub = {
      keys: jest.fn(async () => entries),
      match: jest.fn(async () => ({
        headers: { get: () => String(20 * MB) },
        arrayBuffer: async () => new ArrayBuffer(0),
      })),
      delete: jest.fn(async () => true),
    };
    const caches = { open: async () => cache };
    const win: Record<string, unknown> = { _rn_log: () => {} };
    new Function('caches', 'window', script)(caches, win);
    return { cache, win };
  }

  it('evicts down to the new ceiling as soon as it is set', async () => {
    const { cache, win } = runPage(cacheEvictionScript());
    const setBudgets = win._veloqSetCacheBudgets as (b: Record<string, number>) => void;
    expect(setBudgets).toBeInstanceOf(Function);

    // 200MB of satellite entries against a 60MB ceiling: three survive.
    setBudgets({ 'veloq-satellite-v1': 60 * MB });
    await new Promise(process.nextTick);
    expect(cache.delete).toHaveBeenCalledTimes(7);
  });

  it('deletes nothing when the cache is already under the new ceiling', async () => {
    const { cache, win } = runPage(cacheEvictionScript());
    (win._veloqSetCacheBudgets as (b: Record<string, number>) => void)({
      'veloq-satellite-v1': 400 * MB,
    });
    await new Promise(process.nextTick);
    expect(cache.delete).not.toHaveBeenCalled();
  });

  it('the injected script is inert on a page that has not defined the hook', () => {
    const win: Record<string, unknown> = {};
    expect(() => new Function('window', applyTileCacheBudgetScript(400))(win)).not.toThrow();
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
    await useTileCacheSettings.getState().setBudgetMb(800);

    const written = JSON.parse(store['veloq-tile-cache']);
    expect(written).toEqual({ cacheMode: 'ambient', budgetMb: 800 });

    useTileCacheSettings.setState({ budgetMb: DEFAULT_TILE_CACHE_BUDGET_MB });
    await useTileCacheSettings.getState().initialize();
    expect(useTileCacheSettings.getState().budgetMb).toBe(800);
  });

  it('tells the open pages the moment it changes', async () => {
    const seen: number[] = [];
    const off = onTileCacheBudget((mb) => seen.push(mb));
    await useTileCacheSettings.getState().setBudgetMb(400);
    off();
    expect(seen).toEqual([400]);
  });

  it('ignores a stored value that is not one of the choices', async () => {
    store['veloq-tile-cache'] = JSON.stringify({ budgetMb: 99999 });
    await useTileCacheSettings.getState().initialize();
    expect(useTileCacheSettings.getState().budgetMb).toBe(DEFAULT_TILE_CACHE_BUDGET_MB);
  });
});
