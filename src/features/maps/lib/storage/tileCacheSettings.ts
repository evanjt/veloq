/**
 * The persisted tile cache settings: the athlete's storage ceiling, and a
 * one-off migration of the proactive cache mode an older install may hold.
 *
 * Tiles are cached passively as the user browses, through the Cache API inside
 * the map WebViews, so `cacheMode` has had no runtime reader since it was
 * flattened to ambient. `budgetMb` does: it is the only control left, and the
 * WebView pages are built with it.
 */

import { create } from 'zustand';

import { getSetting, setSetting } from '@/shared/storage';
import { emitTileCacheBudget } from '@/features/maps/lib/terrainSnapshotEvents';
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

  initialize: async () => {
    try {
      const raw = await getSetting(STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      set({ budgetMb: clampTileCacheBudgetMb(parsed.budgetMb), isLoaded: true });
      await flattenCacheMode(parsed);
    } catch {
      set({ budgetMb: DEFAULT_TILE_CACHE_BUDGET_MB, isLoaded: true });
    }
  },

  setBudgetMb: async (mb: number) => {
    const budgetMb = clampTileCacheBudgetMb(mb);
    set({ budgetMb });
    emitTileCacheBudget(budgetMb);
    await persistBudget(budgetMb);
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

/** The launch path reads the key once through `initialize`; a restore calls this on its own. */
export async function migrateTileCacheSettings(): Promise<void> {
  try {
    const stored = await getSetting(STORAGE_KEY);
    if (!stored) return;
    await flattenCacheMode(JSON.parse(stored) as Record<string, unknown>);
  } catch {
    // A corrupt or unreadable value is left alone: startup must not fail on it.
  }
}
