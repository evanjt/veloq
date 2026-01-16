/**
 * Map tile cache management using MapLibre offline capabilities.
 *
 * Provides functions to:
 * - Get the current tile cache size
 * - Clear the tile cache
 * - Cache tiles for activity regions (future)
 *
 * Tiles are automatically cached by MapLibre when viewing maps.
 * This module provides management functions for the settings UI.
 */

import { debug } from '../utils/debug';

const log = debug.create('TileCache');

/**
 * Lazy load MapLibre to avoid issues in Jest/test environments.
 * Returns null if MapLibre is not available (e.g., in tests).
 */
function getMapLibreGL() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@maplibre/maplibre-react-native').default;
  } catch {
    return null;
  }
}

/**
 * Get the total size of cached offline tiles in bytes.
 * Returns 0 if no tiles are cached or if there's an error.
 */
export async function getOfflineTileCacheSize(): Promise<number> {
  try {
    const MapLibreGL = getMapLibreGL();
    if (!MapLibreGL) {
      return 0;
    }

    const packs = await MapLibreGL.offlineManager.getPacks();
    if (!packs || packs.length === 0) {
      return 0;
    }

    let totalSize = 0;
    for (const pack of packs) {
      // The pack object contains metadata about completed resources
      if (pack && typeof pack === 'object') {
        // MapLibre stores size in the pack's progress/metadata
        // Use unknown first then narrow to avoid type mismatch
        const packAny = pack as unknown as Record<string, unknown>;
        if (typeof packAny.completedResourceSize === 'number') {
          totalSize += packAny.completedResourceSize;
        }
      }
    }

    return totalSize;
  } catch (error) {
    log.error('Failed to get tile cache size:', error);
    return 0;
  }
}

/**
 * Clear all cached offline tiles.
 * This removes all offline packs that have been downloaded.
 */
export async function clearOfflineTileCache(): Promise<void> {
  try {
    const MapLibreGL = getMapLibreGL();
    if (!MapLibreGL) {
      log.log('MapLibre not available');
      return;
    }

    const packs = await MapLibreGL.offlineManager.getPacks();
    if (!packs || packs.length === 0) {
      log.log('No tile packs to clear');
      return;
    }

    log.log(`Clearing ${packs.length} offline tile packs...`);

    // Delete each pack by name
    for (const pack of packs) {
      try {
        // MapLibre deletePack expects the pack name as a string
        const packAny = pack as unknown as { name?: string };
        if (packAny.name) {
          await MapLibreGL.offlineManager.deletePack(packAny.name);
        }
      } catch (deleteError) {
        log.error('Failed to delete pack:', deleteError);
      }
    }

    log.log('Tile cache cleared');
  } catch (error) {
    log.error('Failed to clear tile cache:', error);
    throw error;
  }
}

/**
 * Get the number of offline tile packs.
 */
export async function getOfflineTilePackCount(): Promise<number> {
  try {
    const MapLibreGL = getMapLibreGL();
    if (!MapLibreGL) {
      return 0;
    }

    const packs = await MapLibreGL.offlineManager.getPacks();
    return packs?.length ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Cache tiles for a geographic region.
 * This is for future use when implementing activity-bounded caching.
 *
 * @param bounds - Geographic bounds {ne: [lng, lat], sw: [lng, lat]}
 * @param name - Unique name for this offline pack
 * @param styleURL - Map style URL to cache
 * @param minZoom - Minimum zoom level (default: 10)
 * @param maxZoom - Maximum zoom level (default: 13)
 */
export async function cacheRegionTiles(
  bounds: { ne: [number, number]; sw: [number, number] },
  name: string,
  styleURL: string,
  minZoom = 10,
  maxZoom = 13
): Promise<void> {
  try {
    const MapLibreGL = getMapLibreGL();
    if (!MapLibreGL) {
      log.log('MapLibre not available');
      return;
    }

    log.log(`Caching tiles for region "${name}" at zoom ${minZoom}-${maxZoom}`);

    await MapLibreGL.offlineManager.createPack(
      {
        name,
        styleURL,
        bounds: [
          [bounds.sw[0], bounds.sw[1]],
          [bounds.ne[0], bounds.ne[1]],
        ],
        minZoom,
        maxZoom,
      },
      (_pack: unknown, status: { percentage: number }) => {
        if (status.percentage === 100) {
          log.log(`Region "${name}" cached successfully`);
        }
      },
      (_pack: unknown, error: unknown) => {
        log.error(`Failed to cache region "${name}":`, error);
      }
    );
  } catch (error) {
    log.error('Failed to create offline pack:', error);
    throw error;
  }
}
