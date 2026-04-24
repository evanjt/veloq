/**
 * Tile cache management service.
 *
 * Ambient-only: tiles are cached passively by MapLibre as the user browses.
 * This module manages the ambient cache size limit and provides utilities
 * for clearing cached packs and reporting cache status.
 */

import { OfflineManager } from '@maplibre/maplibre-react-native';
import { useTileCacheStore } from '@/providers/TileCacheStore';
import { debug } from '@/lib';

const log = debug.create('TileCacheService');

/** Pack name prefix for identifying Veloq-created packs */
const PACK_PREFIX = 'veloq-';

/** Initialize ambient cache size on app start */
export async function initializeAmbientCache(): Promise<void> {
  try {
    await OfflineManager.setMaximumAmbientCacheSize(50 * 1024 * 1024); // 50MB
  } catch {
    // Not critical
  }
}

/** Clear all Veloq offline packs */
export async function clearAllPacks(): Promise<void> {
  try {
    const packs = await OfflineManager.getPacks();
    for (const pack of packs) {
      if (pack.name?.startsWith(PACK_PREFIX)) {
        await OfflineManager.deletePack(pack.name);
      }
    }
    useTileCacheStore.getState().setNativePackInfo(0, 0);
    log.log('All offline packs cleared');
  } catch (error) {
    log.error('Failed to clear packs:', error);
  }
}

/** Refresh native pack count and size estimate in the store */
export async function refreshNativePackInfo(): Promise<void> {
  try {
    const packs = await OfflineManager.getPacks();
    const veloqPacks = packs.filter((p) => p.name?.startsWith(PACK_PREFIX));
    let totalSize = 0;

    for (const pack of veloqPacks) {
      try {
        const status = await pack.status();
        totalSize += status.completedTileSize;
      } catch {
        // Pack may not have status yet
      }
    }

    useTileCacheStore.getState().setNativePackInfo(veloqPacks.length, totalSize);
  } catch {
    // OfflineManager not available
  }
}

export interface CacheStatus {
  nativePackCount: number;
  nativeSizeBytes: number;
}

/** Get current cache status */
export async function getStatus(): Promise<CacheStatus> {
  await refreshNativePackInfo();
  const state = useTileCacheStore.getState();
  return {
    nativePackCount: state.nativePackCount,
    nativeSizeBytes: state.nativeSizeEstimate,
  };
}
