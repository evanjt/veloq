/**
 * Offline tile cache settings and status store.
 * Ambient-only: tiles are cached passively as the user browses maps.
 * Tracks native pack info for storage display in settings.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { debug } from '@/lib';

const log = debug.create('TileCache');

const STORAGE_KEY = 'veloq-tile-cache';

interface TileCacheState {
  isLoaded: boolean;
  nativePackCount: number;
  nativeSizeEstimate: number;

  initialize: () => Promise<void>;
  setNativePackInfo: (count: number, sizeEstimate: number) => void;
}

export const useTileCacheStore = create<TileCacheState>((set) => ({
  isLoaded: false,
  nativePackCount: 0,
  nativeSizeEstimate: 0,

  initialize: async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        // Migrate: clear any old proactive cache settings, keep key for backup compatibility
        const raw = JSON.parse(stored) as Record<string, unknown>;
        if (raw.cacheMode && raw.cacheMode !== 'ambient') {
          await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ cacheMode: 'ambient' }));
        }
      }
      set({ isLoaded: true });
    } catch {
      set({ isLoaded: true });
    }
  },

  setNativePackInfo: (count: number, sizeEstimate: number) => {
    set({ nativePackCount: count, nativeSizeEstimate: sizeEstimate });
  },
}));

export async function initializeTileCacheStore(): Promise<void> {
  await useTileCacheStore.getState().initialize();
}
