/**
 * Offline tile cache settings and status store.
 * Controls prefetch mode, Wi-Fi-only preference, and tracks download progress.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { debug, safeJsonParseWithSchema } from '@/lib';

const log = debug.create('TileCache');

const STORAGE_KEY = 'veloq-tile-cache';

export type CacheMode = 'standard' | 'maximum';

export type PrefetchStatus = 'idle' | 'computing' | 'downloading' | 'complete' | 'error';

interface TileCacheSettings {
  enabled: boolean;
  wifiOnly: boolean;
  cacheMode: CacheMode;
}

const DEFAULT_SETTINGS: TileCacheSettings = {
  enabled: true,
  wifiOnly: true,
  cacheMode: 'standard',
};

function isTileCacheSettings(value: unknown): value is TileCacheSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  if ('enabled' in obj && typeof obj.enabled !== 'boolean') return false;
  if ('wifiOnly' in obj && typeof obj.wifiOnly !== 'boolean') return false;
  if ('cacheMode' in obj && obj.cacheMode !== 'standard' && obj.cacheMode !== 'maximum')
    return false;
  return true;
}

interface TileCacheState {
  settings: TileCacheSettings;
  isLoaded: boolean;
  prefetchStatus: PrefetchStatus;
  progress: { downloaded: number; total: number };
  lastPrefetchDate: string | null;
  lastCleanupDate: string | null;
  nativePackCount: number;
  nativeSizeEstimate: number;
  errorMessage: string | null;

  initialize: () => Promise<void>;
  setEnabled: (enabled: boolean) => void;
  setWifiOnly: (wifiOnly: boolean) => void;
  setCacheMode: (mode: CacheMode) => void;
  setPrefetchStatus: (status: PrefetchStatus) => void;
  setProgress: (downloaded: number, total: number) => void;
  setLastPrefetchDate: (date: string) => void;
  setLastCleanupDate: (date: string) => void;
  setNativePackInfo: (count: number, sizeEstimate: number) => void;
  setErrorMessage: (message: string | null) => void;
}

function persistSettings(settings: TileCacheSettings) {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings)).catch((error) => {
    log.error('Failed to save tile cache settings:', error);
  });
}

export const useTileCacheStore = create<TileCacheState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  isLoaded: false,
  prefetchStatus: 'idle',
  progress: { downloaded: 0, total: 0 },
  lastPrefetchDate: null,
  lastCleanupDate: null,
  nativePackCount: 0,
  nativeSizeEstimate: 0,
  errorMessage: null,

  initialize: async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = safeJsonParseWithSchema(stored, isTileCacheSettings, DEFAULT_SETTINGS);
        set({ settings: { ...DEFAULT_SETTINGS, ...parsed }, isLoaded: true });
      } else {
        set({ isLoaded: true });
      }
    } catch {
      set({ isLoaded: true });
    }
  },

  setEnabled: (enabled: boolean) => {
    set((state) => {
      const newSettings = { ...state.settings, enabled };
      persistSettings(newSettings);
      return { settings: newSettings };
    });
  },

  setWifiOnly: (wifiOnly: boolean) => {
    set((state) => {
      const newSettings = { ...state.settings, wifiOnly };
      persistSettings(newSettings);
      return { settings: newSettings };
    });
  },

  setCacheMode: (mode: CacheMode) => {
    set((state) => {
      const newSettings = { ...state.settings, cacheMode: mode };
      persistSettings(newSettings);
      return { settings: newSettings };
    });
  },

  setPrefetchStatus: (status: PrefetchStatus) => {
    set({ prefetchStatus: status, errorMessage: status === 'error' ? get().errorMessage : null });
  },

  setProgress: (downloaded: number, total: number) => {
    set({ progress: { downloaded, total } });
  },

  setLastPrefetchDate: (date: string) => {
    set({ lastPrefetchDate: date });
  },

  setLastCleanupDate: (date: string) => {
    set({ lastCleanupDate: date });
  },

  setNativePackInfo: (count: number, sizeEstimate: number) => {
    set({ nativePackCount: count, nativeSizeEstimate: sizeEstimate });
  },

  setErrorMessage: (message: string | null) => {
    set({ errorMessage: message });
  },
}));

/** Derived: radius in km based on cache mode */
export function getCacheRadius(): number {
  return useTileCacheStore.getState().settings.cacheMode === 'maximum' ? 20 : 5;
}

/** Derived: whether all styles should be cached */
export function shouldCacheAllStyles(): boolean {
  return useTileCacheStore.getState().settings.cacheMode === 'maximum';
}

export async function initializeTileCacheStore(): Promise<void> {
  await useTileCacheStore.getState().initialize();
}
