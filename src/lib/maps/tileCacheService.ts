/**
 * Singleton tile cache orchestrator.
 *
 * Manages proactive offline tile prefetching for both native MapLibre 2D
 * (via OfflineManager packs) and WebView MapLibre GL JS 3D (via Cache API).
 * Handles geographic clustering, style-aware caching, and 90-day cleanup.
 */

import * as FileSystem from 'expo-file-system/legacy';
import { OfflineManager } from '@maplibre/maplibre-react-native';
import type { OfflinePack, OfflinePackStatus } from '@maplibre/maplibre-react-native';

import {
  MAP_STYLE_URLS,
  SATELLITE_SOURCES,
  getCombinedSatelliteStyle,
} from '@/components/maps/mapStyles';
import type { MapStyleType, CombinedSatelliteMapStyle } from '@/components/maps/mapStyles';
import {
  clusterActivityBounds,
  enumerateTileUrls,
  estimateTotalTiles,
  boundsOverlap,
  type Bounds,
  type TileCluster,
} from './tileGeometry';
import { generatePreloadScript, type PreloadConfig } from './tilePreloader';
import {
  emitPrefetchTilesRequest,
  emitCancelWebViewPrefetch,
  onPrefetchTilesProgress,
} from '@/lib/events/terrainSnapshotEvents';
import {
  useTileCacheStore,
  getCacheRadius,
  shouldCacheAllStyles,
} from '@/providers/TileCacheStore';
import { debug } from '@/lib';

const log = debug.create('TileCacheService');

/** Pack name prefix for identifying Veloq-created packs */
const PACK_PREFIX = 'veloq-';

/** Grid size for activity clustering (km) */
const GRID_SIZE_KM = 20;

/** Zoom ranges per tile source type */
const ZOOM_RANGES = {
  vector: [0, 14] as [number, number],
  satellite: [10, 14] as [number, number],
  terrain: [8, 13] as [number, number],
} as const;

/** Delay between native pack creations (ms) — gentle trickle */
const INTER_PACK_DELAY_MS = 5000;

/** WebView trickle config: ~5 tiles/sec */
const WEBVIEW_CONFIG: PreloadConfig = { concurrency: 1, delayMs: 200 };

/** Minimum free disk space to allow prefetching (500 MB) */
const MIN_FREE_SPACE_BYTES = 500 * 1024 * 1024;

/** Free space threshold below which maximum mode is downgraded to standard (2 GB) */
const MAX_MODE_FREE_SPACE_BYTES = 2 * 1024 * 1024 * 1024;

/** DEM terrain tile template */
const TERRAIN_TILE_TEMPLATE =
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

/** Vector tile template (OpenFreeMap) */
const VECTOR_TILE_TEMPLATE = 'https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf';

/** Abort controller for cancelling in-flight prefetch */
let abortController: AbortController | null = null;

export interface CacheStatus {
  nativePackCount: number;
  nativeSizeBytes: number;
  lastPrefetchDate: string | null;
  lastCleanupDate: string | null;
}

/**
 * Check available device storage and determine if prefetching should proceed.
 * Returns available bytes, or 0 if storage check fails.
 */
async function getFreeDiskSpace(): Promise<number> {
  try {
    const free = await FileSystem.getFreeDiskStorageAsync();
    return free;
  } catch {
    return 0;
  }
}

/**
 * Write a minimal satellite style JSON to disk for use with OfflineManager.createPack().
 * OfflineManager requires a styleURL string, not an inline JSON object.
 * Returns a file:// URI pointing to the written style.
 */
async function writeSatelliteStyleFile(): Promise<string> {
  const style = getCombinedSatelliteStyle();
  const path = `${FileSystem.cacheDirectory}satellite-offline-style.json`;
  await FileSystem.writeAsStringAsync(path, JSON.stringify(style));
  return `file://${path}`;
}

/**
 * Get the styles that need to be cached based on user preferences.
 */
function getStylesToPrefetch(
  defaultStyle: MapStyleType,
  activityTypeStyles: Record<string, MapStyleType | null>
): Set<MapStyleType> {
  if (shouldCacheAllStyles()) {
    return new Set<MapStyleType>(['light', 'dark', 'satellite']);
  }

  const styles = new Set<MapStyleType>([defaultStyle]);

  // Add per-activity-type style overrides
  for (const style of Object.values(activityTypeStyles)) {
    if (style) styles.add(style);
  }

  return styles;
}

/**
 * Get the styleURL string for a given style type.
 * For satellite, writes a temp file and returns file:// URL.
 */
async function getStyleURL(style: MapStyleType): Promise<string> {
  if (style === 'light' || style === 'dark') {
    // Both light and dark use the same vector tile source
    return MAP_STYLE_URLS.light;
  }
  return writeSatelliteStyleFile();
}

/**
 * Get a style key for pack naming (light and dark share vector tiles).
 */
function getStyleKey(style: MapStyleType): string {
  // Light and dark both use OpenFreeMap vector tiles, so one pack covers both
  if (style === 'light' || style === 'dark') return 'vector';
  return 'satellite';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create native MapLibre offline packs for the given clusters and style.
 */
/** Tracks cumulative tile downloads across all packs and WebView batches */
let cumulativeDownloaded = 0;
let overallTotal = 0;

async function prefetchNativePacks(
  clusters: TileCluster[],
  style: MapStyleType,
  signal: AbortSignal
): Promise<void> {
  const styleKey = getStyleKey(style);
  const styleURL = await getStyleURL(style);

  const zoomRange = styleKey === 'vector' ? ZOOM_RANGES.vector : ZOOM_RANGES.satellite;

  let existingPacks: OfflinePack[];
  try {
    existingPacks = await OfflineManager.getPacks();
  } catch {
    existingPacks = [];
  }
  const existingNames = new Set(existingPacks.map((p) => p.name).filter(Boolean));

  const store = useTileCacheStore.getState();

  let isFirstPack = true;
  for (const cluster of clusters) {
    if (signal.aborted) return;

    const packName = `${PACK_PREFIX}${styleKey}-${cluster.hash}`;
    if (existingNames.has(packName)) continue;

    // Trickle: wait between pack creations to be gentle on tile servers
    if (!isFirstPack) {
      await sleep(INTER_PACK_DELAY_MS);
      if (signal.aborted) return;
    }
    isFirstPack = false;

    const packStartOffset = cumulativeDownloaded;

    try {
      await OfflineManager.createPack(
        {
          name: packName,
          styleURL,
          bounds: [
            [cluster.bounds.maxLng, cluster.bounds.maxLat], // NE [lng, lat]
            [cluster.bounds.minLng, cluster.bounds.minLat], // SW [lng, lat]
          ],
          minZoom: zoomRange[0],
          maxZoom: zoomRange[1],
          metadata: {
            createdAt: Date.now(),
            clusterHash: cluster.hash,
            styleKey,
          },
        },
        (_pack: OfflinePack, status: OfflinePackStatus) => {
          // Accumulate: pack's completed + tiles from previous packs
          cumulativeDownloaded = packStartOffset + status.completedTileCount;
          store.setProgress(cumulativeDownloaded, overallTotal);
        },
        (_pack: OfflinePack, err: { name: string; message: string }) => {
          log.error(`Pack ${packName} error: ${err.message}`);
        }
      );
      log.log(`Created pack: ${packName}`);
    } catch (error) {
      log.error(`Failed to create pack ${packName}:`, error);
    }
  }
}

/**
 * Prefetch terrain DEM and additional tiles via the WebView Cache API.
 * Sends tile URLs to TerrainSnapshotWebView for background downloading.
 */
function prefetchWebViewTiles(
  clusters: TileCluster[],
  styles: Set<MapStyleType>,
  config?: PreloadConfig
): void {
  const batches: Array<{ urls: string[]; cacheName: string; config?: PreloadConfig }> = [];

  // Always prefetch terrain DEM tiles
  const terrainUrls = enumerateTileUrls(clusters, TERRAIN_TILE_TEMPLATE, ZOOM_RANGES.terrain);
  if (terrainUrls.length > 0) {
    batches.push({ urls: terrainUrls, cacheName: 'veloq-terrain-dem-v1', config });
  }

  // Prefetch satellite tiles for WebView 3D rendering
  if (styles.has('satellite')) {
    // Global EOX (low-res base layer)
    const eoxUrls = enumerateTileUrls(
      clusters,
      SATELLITE_SOURCES.eox.tiles[0],
      ZOOM_RANGES.satellite
    );
    if (eoxUrls.length > 0) {
      batches.push({ urls: eoxUrls, cacheName: 'veloq-satellite-v1', config });
    }

    // Regional high-res sources — only for clusters overlapping region bounds
    for (const [sourceId, source] of Object.entries(SATELLITE_SOURCES)) {
      if (sourceId === 'eox') continue;
      if (!source.bounds) continue;
      const regionalClusters = clusters.filter((c) => boundsOverlap(c.bounds, source.bounds!));
      if (regionalClusters.length === 0) continue;
      const urls = enumerateTileUrls(regionalClusters, source.tiles[0], ZOOM_RANGES.satellite);
      if (urls.length > 0) {
        batches.push({ urls, cacheName: 'veloq-satellite-v1', config });
      }
    }
  }

  // Prefetch vector tiles for WebView 3D terrain overlay
  if (styles.has('light') || styles.has('dark')) {
    const vectorUrls = enumerateTileUrls(clusters, VECTOR_TILE_TEMPLATE, ZOOM_RANGES.terrain);
    if (vectorUrls.length > 0) {
      batches.push({ urls: vectorUrls, cacheName: 'veloq-vector-v1', config });
    }
  }

  if (batches.length > 0) {
    emitPrefetchTilesRequest(batches);
  }
}

/**
 * Count how many WebView tile batches will be emitted for progress tracking.
 */
function countWebViewBatches(clusters: TileCluster[], styles: Set<MapStyleType>): number {
  let count = 0;
  // Terrain
  const terrainUrls = enumerateTileUrls(clusters, TERRAIN_TILE_TEMPLATE, ZOOM_RANGES.terrain);
  if (terrainUrls.length > 0) count++;
  // Satellite
  if (styles.has('satellite')) {
    const eoxUrls = enumerateTileUrls(
      clusters,
      SATELLITE_SOURCES.eox.tiles[0],
      ZOOM_RANGES.satellite
    );
    if (eoxUrls.length > 0) count++;
    for (const [sourceId, source] of Object.entries(SATELLITE_SOURCES)) {
      if (sourceId === 'eox' || !source.bounds) continue;
      const regional = clusters.filter((c) => boundsOverlap(c.bounds, source.bounds!));
      if (regional.length === 0) continue;
      const urls = enumerateTileUrls(regional, source.tiles[0], ZOOM_RANGES.satellite);
      if (urls.length > 0) count++;
    }
  }
  // Vector
  if (styles.has('light') || styles.has('dark')) {
    const vecUrls = enumerateTileUrls(clusters, VECTOR_TILE_TEMPLATE, ZOOM_RANGES.terrain);
    if (vecUrls.length > 0) count++;
  }
  return count;
}

/**
 * Wait for WebView prefetch batches to report completion via progress events.
 * Each batch emits a final progress message when completed === total.
 * Times out after 5 minutes to avoid blocking indefinitely.
 */
function waitForWebViewPrefetch(
  expectedBatches: number,
  _store: ReturnType<typeof useTileCacheStore.getState>,
  signal: AbortSignal
): Promise<void> {
  return new Promise<void>((resolve) => {
    let completedBatches = 0;
    // Track last-seen downloaded count to compute forward deltas only
    let lastDownloaded = 0;
    const timeout = setTimeout(
      () => {
        unsubscribe();
        log.log(`WebView prefetch timeout — ${completedBatches}/${expectedBatches} batches done`);
        resolve();
      },
      5 * 60 * 1000
    );

    // Each batch emits progress events where completed/total are cumulative for that batch.
    // When completed >= total, that batch is done and the next batch starts from 0.
    const unsubscribe = onPrefetchTilesProgress((downloaded, total) => {
      // Detect batch boundary: downloaded < lastDownloaded means a new batch started
      if (downloaded < lastDownloaded) {
        lastDownloaded = 0;
      }
      const delta = downloaded - lastDownloaded;
      lastDownloaded = downloaded;

      if (delta > 0) {
        cumulativeDownloaded += delta;
        useTileCacheStore.getState().setProgress(cumulativeDownloaded, overallTotal);
      }

      if (downloaded >= total && total > 0) {
        completedBatches++;
        lastDownloaded = 0; // reset for next batch
        log.log(`WebView batch ${completedBatches}/${expectedBatches} done (${total} tiles)`);
        if (completedBatches >= expectedBatches) {
          clearTimeout(timeout);
          unsubscribe();
          resolve();
        }
      }
    });

    if (signal.aborted) {
      clearTimeout(timeout);
      unsubscribe();
      resolve();
    }
  });
}

/**
 * Main prefetch entry point.
 * Clusters activities, checks storage, and downloads tiles for both
 * native 2D maps and WebView 3D maps.
 */
export async function prefetch(
  activities: Array<{ bounds: Bounds }>,
  defaultStyle: MapStyleType,
  activityTypeStyles: Record<string, MapStyleType | null>
): Promise<void> {
  const store = useTileCacheStore.getState();

  if (store.settings.cacheMode === 'ambient') return;
  if (activities.length === 0) return;

  // Cancel any in-flight prefetch
  cancelPrefetch();
  abortController = new AbortController();
  const { signal } = abortController;

  try {
    store.setPrefetchStatus('computing');

    // Check storage
    const freeSpace = await getFreeDiskSpace();
    if (freeSpace > 0 && freeSpace < MIN_FREE_SPACE_BYTES) {
      log.log(`Low storage (${(freeSpace / 1024 / 1024).toFixed(0)} MB) — skipping prefetch`);
      store.setErrorMessage('Not enough storage for offline tiles');
      store.setPrefetchStatus('error');
      return;
    }

    // Downgrade to standard mode if storage is limited
    const effectiveMode =
      freeSpace > 0 &&
      freeSpace < MAX_MODE_FREE_SPACE_BYTES &&
      store.settings.cacheMode === 'maximum'
        ? 'standard'
        : store.settings.cacheMode;

    const radiusKm = effectiveMode === 'maximum' ? 5 : 0;
    const clusters = clusterActivityBounds(activities, GRID_SIZE_KM, radiusKm);

    if (clusters.length === 0) {
      store.setPrefetchStatus('complete');
      return;
    }

    const styles =
      effectiveMode === 'maximum'
        ? new Set<MapStyleType>(['light', 'dark', 'satellite'])
        : getStylesToPrefetch(defaultStyle, activityTypeStyles);

    // Estimate total tiles for progress tracking
    const sources: Array<{ zoomRange: [number, number] }> = [];
    if (styles.has('light') || styles.has('dark')) sources.push({ zoomRange: ZOOM_RANGES.vector });
    if (styles.has('satellite')) sources.push({ zoomRange: ZOOM_RANGES.satellite });
    sources.push({ zoomRange: ZOOM_RANGES.terrain }); // Always terrain
    const totalTiles = estimateTotalTiles(clusters, sources);

    // Reset cumulative counters for this prefetch run
    cumulativeDownloaded = 0;
    overallTotal = totalTiles;
    store.setProgress(0, totalTiles);
    store.setPrefetchStatus('downloading');

    if (signal.aborted) return;

    // Deduplicate: vector pack serves both light and dark
    const nativeStyles = new Set<MapStyleType>();
    if (styles.has('light') || styles.has('dark')) nativeStyles.add('light');
    if (styles.has('satellite')) nativeStyles.add('satellite');

    // Prefetch native packs
    for (const style of nativeStyles) {
      if (signal.aborted) return;
      await prefetchNativePacks(clusters, style, signal);
    }

    if (signal.aborted) return;

    // Prefetch WebView tiles (terrain DEM + satellite/vector for 3D)
    // Count batches to track when all WebView prefetch completes
    const webViewBatchCount = countWebViewBatches(clusters, styles);

    if (webViewBatchCount > 0) {
      prefetchWebViewTiles(clusters, styles, WEBVIEW_CONFIG);

      // Wait for WebView batches to complete (with timeout)
      await waitForWebViewPrefetch(webViewBatchCount, store, signal);
    }

    // Update status
    store.setPrefetchStatus('complete');
    store.setLastPrefetchDate(new Date().toISOString());
    log.log(
      `Prefetch complete: ${clusters.length} clusters, ${nativeStyles.size} native styles, ~${totalTiles} tiles`
    );

    // Update native pack count
    await refreshNativePackInfo();
  } catch (error) {
    if (!signal.aborted) {
      log.error('Prefetch failed:', error);
      store.setErrorMessage(error instanceof Error ? error.message : 'Prefetch failed');
      store.setPrefetchStatus('error');
    }
  } finally {
    abortController = null;
  }
}

/** Cancel any in-flight prefetch operation */
export function cancelPrefetch(): void {
  if (abortController) {
    abortController.abort();
    abortController = null;
    useTileCacheStore.getState().setPrefetchStatus('idle');
  }
  emitCancelWebViewPrefetch();
}

/**
 * 90-day cleanup: delete native packs whose clusters no longer match current activities.
 */
export async function cleanup(currentActivities: Array<{ bounds: Bounds }>): Promise<void> {
  const radiusKm = getCacheRadius();
  const currentClusters = clusterActivityBounds(currentActivities, GRID_SIZE_KM, radiusKm);
  const validHashes = new Set(currentClusters.map((c) => c.hash));

  let existingPacks: OfflinePack[];
  try {
    existingPacks = await OfflineManager.getPacks();
  } catch {
    return;
  }

  let deleted = 0;
  for (const pack of existingPacks) {
    const name = pack.name;
    if (!name?.startsWith(PACK_PREFIX)) continue;

    const metadata = pack.metadata;
    const clusterHash = metadata?.clusterHash as string | undefined;

    if (clusterHash && !validHashes.has(clusterHash)) {
      try {
        await OfflineManager.deletePack(name);
        deleted++;
      } catch (error) {
        log.error(`Failed to delete pack ${name}:`, error);
      }
    }
  }

  if (deleted > 0) {
    log.log(`Cleanup: deleted ${deleted} stale packs`);
  }

  useTileCacheStore.getState().setLastCleanupDate(new Date().toISOString());
  await refreshNativePackInfo();
}

/** Refresh native pack count and size estimate in the store */
async function refreshNativePackInfo(): Promise<void> {
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

/** Get current cache status */
export async function getStatus(): Promise<CacheStatus> {
  await refreshNativePackInfo();
  const state = useTileCacheStore.getState();
  return {
    nativePackCount: state.nativePackCount,
    nativeSizeBytes: state.nativeSizeEstimate,
    lastPrefetchDate: state.lastPrefetchDate,
    lastCleanupDate: state.lastCleanupDate,
  };
}

/** Initialize ambient cache size on app start */
export async function initializeAmbientCache(): Promise<void> {
  try {
    await OfflineManager.setMaximumAmbientCacheSize(100 * 1024 * 1024); // 100MB
  } catch {
    // Not critical
  }
}
