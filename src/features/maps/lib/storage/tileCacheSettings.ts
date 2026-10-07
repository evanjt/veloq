/**
 * The persisted tile cache settings: the athlete's storage ceiling, and a
 * one-off migration of the proactive cache mode an older install may hold.
 *
 * Tiles are cached passively as the athlete browses. On both handsets they
 * live in the Rust store, which takes `budgetMb` as its ceiling. `cacheMode` has had no runtime reader since it was
 * flattened to ambient.
 */

import { create } from 'zustand';

import { getSetting, setSetting } from '@/shared/storage';
import { applyBasemapBudget } from '@/features/maps/lib/basemapCache';
import {
  clampTileCacheBudgetMb,
  DEFAULT_TILE_CACHE_BUDGET_MB,
} from '@/features/maps/lib/tileCacheBudget';

const STORAGE_KEY = 'veloq-tile-cache';

interface TileCacheSettingsState {
  budgetMb: number;
  isLoaded: boolean;
  initialize: () => Promise<void>;
  setBudgetMb: (mb: number) => Promise<void>;
}

async function persistBudget(mb: number): Promise<void> {
  let stored: Record<string, unknown> = {};
  try {
    const raw = await getSetting(STORAGE_KEY);
    if (raw) stored = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // A corrupt value is replaced rather than merged into.
  }
  await setSetting(STORAGE_KEY, JSON.stringify({ ...stored, budgetMb: mb }));
}

export const useTileCacheSettings = create<TileCacheSettingsState>((set) => ({
  budgetMb: DEFAULT_TILE_CACHE_BUDGET_MB,
  isLoaded: false,

  /**
   * Load the ceiling from storage. Launch runs it, and so does a restore, and
   * either way the store is brought under the ceiling it read.
   */
  initialize: async () => {
    let budgetMb = DEFAULT_TILE_CACHE_BUDGET_MB;
    let parsed: Record<string, unknown> = {};
    try {
      const raw = await getSetting(STORAGE_KEY);
      parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      budgetMb = clampTileCacheBudgetMb(parsed.budgetMb);
    } catch {
      // A corrupt or unreadable value takes the default.
    }
    set({ budgetMb, isLoaded: true });
    // Not awaited: launch awaits this initialiser, and bringing the store under
    // a lowered ceiling can delete thousands of files on a Rust thread.
    void applyBasemapBudget(budgetMb);
    try {
      await flattenCacheMode(parsed);
    } catch {
      // Startup must not fail on a migration nothing reads.
    }
  },

  setBudgetMb: async (mb: number) => {
    const budgetMb = clampTileCacheBudgetMb(mb);
    set({ budgetMb });
    // Resolves once the store has evicted down to the new ceiling, so a caller
    // that re-reads what the store holds sees the post-eviction size.
    await Promise.all([applyBasemapBudget(budgetMb), persistBudget(budgetMb)]);
  },
}));

/** The current ceiling, for the page builders, which are not components. */
export function getTileCacheBudgetMb(): number {
  return useTileCacheSettings.getState().budgetMb;
}

export async function initializeTileCacheSettings(): Promise<void> {
  await useTileCacheSettings.getState().initialize();
}

/** An older install's proactive cache mode is flattened to ambient in place. */
async function flattenCacheMode(raw: Record<string, unknown>): Promise<void> {
  if (raw.cacheMode && raw.cacheMode !== 'ambient') {
    await setSetting(STORAGE_KEY, JSON.stringify({ cacheMode: 'ambient' }));
  }
}
