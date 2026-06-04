/**
 * Offline tile cache settings and status store.
 * Ambient-only: tiles are cached passively as the user browses maps.
 * Tracks native pack info for storage display in settings.
 *
 * TODO(ambient-cache-sizing): `nativeSizeEstimate` currently only reflects the
 * size of pre-downloaded offline *packs* (see `tileCacheService.ts` →
 * `refreshNativePackInfo`). It does NOT reflect the ambient tile cache that
 * MapLibre fills as the user browses 2D maps (BaseMapView / RegionalMapView),
 * so the settings storage display never grows even as the ambient cache fills
 * toward its 50 MB cap.
 *
 * Fixing this requires a native-bridge addition: `@maplibre/maplibre-react-native`
 * v10 (OfflineManager) exposes `setMaximumAmbientCacheSize`, `clearAmbientCache`,
 * `invalidateAmbientCache`, and `resetDatabase`, but NO getter for current
 * ambient cache size. Confirmed by inspecting both the JS wrapper
 * (`node_modules/@maplibre/maplibre-react-native/src/modules/offline/OfflineManager.ts`)
 * and the Android/iOS native modules (`MLRNOfflineModule.java`, `MLRNOfflineModule.m`).
 * Neither `getAmbientCacheSize()` nor `getDatabasePath()` is bridged.
 *
 * Options to unblock this:
 *   1. Upstream PR adding `getAmbientCacheSize()` to OfflineManager on both
 *      platforms (MapLibre core has the info — Android: `OfflineManager.getOfflineRegions`
 *      + `FileSource` db path; iOS: similar via `MLNOfflineStorage`).
 *   2. Patch-package the MapLibre RN module locally to add a bridged method
 *      that calls `context.getDatabasePath(OFFLINE_DB)` on Android and reads
 *      the SQLite file size via `RNFS`/`expo-file-system`, and the equivalent
 *      on iOS (`~/Library/Application Support/.mapbox/cache.db`-style path).
 *   3. Use our own Rust FFI to `stat(2)` MapLibre's cache DB file once its
 *      path is known per-platform (brittle — path changes between SDK versions).
 *
 * Until one of these lands, `nativeSizeEstimate` stays pack-only and the
 * settings breakdown shows ambient cache growth only via the WebView-side
 * tile counts (Cache API), which covers Map3D tiles but not the 2D ambient
 * cache.
 */

import { create } from 'zustand';
import { getSetting, setSetting } from '@/lib/backup';
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

  setNativePackInfo: (count: number, sizeEstimate: number) => {
    set({ nativePackCount: count, nativeSizeEstimate: sizeEstimate });
  },
}));

export async function initializeTileCacheStore(): Promise<void> {
  await useTileCacheStore.getState().initialize();
}
