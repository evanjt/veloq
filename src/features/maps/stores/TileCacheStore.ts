/**
 * Offline tile cache settings store.
 *
 * Tiles are cached passively as the user browses, through the Cache API inside
 * the map WebViews. Reported sizes come from those caches directly, so this
 * store only carries the persisted settings the backup flow expects.
 */

import { create } from 'zustand';
import { getSetting, setSetting } from '@/shared/storage';

const STORAGE_KEY = 'veloq-tile-cache';

interface TileCacheState {
  isLoaded: boolean;
  initialize: () => Promise<void>;
}

export const useTileCacheStore = create<TileCacheState>((set) => ({
  isLoaded: false,

  initialize: async () => {
    try {
      const stored = await getSetting(STORAGE_KEY);
      if (stored) {
        // Migrate: clear any old proactive cache settings, keep key for backup compatibility
        const raw = JSON.parse(stored) as Record<string, unknown>;
        if (raw.cacheMode && raw.cacheMode !== 'ambient') {
          await setSetting(STORAGE_KEY, JSON.stringify({ cacheMode: 'ambient' }));
        }
      }
      set({ isLoaded: true });
    } catch {
      set({ isLoaded: true });
    }
  },
}));

export async function initializeTileCacheStore(): Promise<void> {
  await useTileCacheStore.getState().initialize();
}
