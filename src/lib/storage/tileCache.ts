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
import { MAP_STYLE_URLS } from '@/components/maps/mapStyles';

const log = debug.create('TileCache');

/** Default style URL for offline caching (light style works best offline) */
const DEFAULT_CACHE_STYLE_URL = MAP_STYLE_URLS.light;

/**
 * Lazy load MapTileSettings store to avoid issues in Jest/test environments.
 * The store uses AsyncStorage which isn't available in tests.
 */
function getMapTileSettings() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useMapTileSettings } = require('@/providers/MapTileSettingsStore');
    return useMapTileSettings;
  } catch {
    return null;
  }
}

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

/**
 * Activity bounds from FfiActivityMapResult.
 * Format: [ne_lat, ne_lng, sw_lat, sw_lng]
 */
export interface ActivityBounds {
  activityId: string;
  bounds: number[]; // [ne_lat, ne_lng, sw_lat, sw_lng]
}

/**
 * Cache tiles for multiple activity regions.
 * Checks if tile caching is enabled before proceeding.
 * Skips activities with invalid or missing bounds.
 *
 * @param activities - Array of activity bounds from GPS sync
 * @param minZoom - Minimum zoom level (default: 10)
 * @param maxZoom - Maximum zoom level (default: 13)
 * @returns Number of activities queued for tile caching
 */
export async function cacheActivityTiles(
  activities: ActivityBounds[],
  minZoom = 10,
  maxZoom = 13
): Promise<number> {
  // Check if tile caching is enabled
  const useMapTileSettings = getMapTileSettings();
  if (!useMapTileSettings) {
    log.log('MapTileSettings store not available');
    return 0;
  }

  const { settings } = useMapTileSettings.getState();
  if (!settings.enabled) {
    log.log('Tile caching disabled, skipping');
    return 0;
  }

  const MapLibreGL = getMapLibreGL();
  if (!MapLibreGL) {
    log.log('MapLibre not available');
    return 0;
  }

  // Filter activities with valid bounds
  const validActivities = activities.filter((a) => {
    // Bounds should be [ne_lat, ne_lng, sw_lat, sw_lng] - 4 elements
    if (!a.bounds || a.bounds.length !== 4) return false;
    // Check for valid coordinate ranges
    const [neLat, neLng, swLat, swLng] = a.bounds;
    return (
      isFinite(neLat) &&
      isFinite(neLng) &&
      isFinite(swLat) &&
      isFinite(swLng) &&
      Math.abs(neLat) <= 90 &&
      Math.abs(swLat) <= 90 &&
      Math.abs(neLng) <= 180 &&
      Math.abs(swLng) <= 180
    );
  });

  if (validActivities.length === 0) {
    log.log('No activities with valid bounds to cache');
    return 0;
  }

  log.log(`Caching tiles for ${validActivities.length} activities`);

  let cachedCount = 0;

  for (const activity of validActivities) {
    try {
      const [neLat, neLng, swLat, swLng] = activity.bounds;

      // Convert to the format expected by cacheRegionTiles
      // Note: bounds format for MapLibre is [[sw_lng, sw_lat], [ne_lng, ne_lat]]
      // Our cacheRegionTiles expects { ne: [lng, lat], sw: [lng, lat] }
      await cacheRegionTiles(
        {
          ne: [neLng, neLat],
          sw: [swLng, swLat],
        },
        `activity-${activity.activityId}`,
        DEFAULT_CACHE_STYLE_URL,
        minZoom,
        maxZoom
      );
      cachedCount++;
    } catch (error) {
      // Log but don't fail the entire batch
      log.error(`Failed to cache tiles for activity ${activity.activityId}:`, error);
    }
  }

  log.log(`Queued ${cachedCount} activities for tile caching`);
  return cachedCount;
}
