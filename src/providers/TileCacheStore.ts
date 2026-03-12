/**
 * Offline tile cache settings and status store.
 * Controls prefetch mode, Wi-Fi-only preference, and tracks download progress.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { debug, safeJsonParseWithSchema } from '@/lib';

const log = debug.create('TileCache');

const STORAGE_KEY = 'veloq-tile-cache';

export type CacheMode = 'ambient' | 'standard' | 'maximum';

export type PrefetchStatus = 'idle' | 'computing' | 'downloading' | 'complete' | 'error';

interface TileCacheSettings {
  wifiOnly: boolean;
  cacheMode: CacheMode;
}

const DEFAULT_SETTINGS: TileCacheSettings = {
  wifiOnly: true,
  cacheMode: 'ambient',
};

function isTileCacheSettings(value: unknown): value is TileCacheSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  if ('wifiOnly' in obj && typeof obj.wifiOnly !== 'boolean') return false;
  if (
    'cacheMode' in obj &&
    obj.cacheMode !== 'ambient' &&
    obj.cacheMode !== 'standard' &&
    obj.cacheMode !== 'maximum'
  )
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
        const raw = JSON.parse(stored) as Record<string, unknown>;
        // Migrate old format: { enabled: boolean, cacheMode: 'standard'|'maximum' }
        // → new format: { cacheMode: 'ambient'|'standard'|'maximum' }
        if ('enabled' in raw && typeof raw.enabled === 'boolean') {
          const migrated: TileCacheSettings = {
            wifiOnly: typeof raw.wifiOnly === 'boolean' ? raw.wifiOnly : DEFAULT_SETTINGS.wifiOnly,
            cacheMode: raw.enabled
              ? raw.cacheMode === 'maximum'
                ? 'maximum'
                : 'standard'
              : 'ambient',
          };
          persistSettings(migrated);
          set({ settings: migrated, isLoaded: true });
        } else {
          const parsed = safeJsonParseWithSchema(stored, isTileCacheSettings, DEFAULT_SETTINGS);
          set({ settings: { ...DEFAULT_SETTINGS, ...parsed }, isLoaded: true });
        }
      } else {
        set({ isLoaded: true });
      }
    } catch {
      set({ isLoaded: true });
    }
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
      if (mode === 'ambient') {
        return {
          settings: newSettings,
          prefetchStatus: 'idle' as PrefetchStatus,
          progress: { downloaded: 0, total: 0 },
        };
      }
      return { settings: newSettings };
    });
  },

  setPrefetchStatus: (status: PrefetchStatus) => {
    set({ prefetchStatus: status, errorMessage: status === 'error' ? get().errorMessage : null });
  },

  setProgress: (downloaded: number, total: number) => {
    // Monotonic: never let downloaded go backwards (prevents visual jitter
    // from interleaved native pack callbacks and WebView progress events)
    const current = get().progress.downloaded;
    set({ progress: { downloaded: Math.max(downloaded, current), total } });
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

/** Derived: radius in km based on cache mode (ambient and standard use 0) */
export function getCacheRadius(): number {
  return useTileCacheStore.getState().settings.cacheMode === 'maximum' ? 5 : 0;
}

/** Derived: whether all styles should be cached */
export function shouldCacheAllStyles(): boolean {
  return useTileCacheStore.getState().settings.cacheMode === 'maximum';
}

export async function initializeTileCacheStore(): Promise<void> {
  await useTileCacheStore.getState().initialize();
}
