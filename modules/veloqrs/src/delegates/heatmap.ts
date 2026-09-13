/**
 * Heatmap tile delegates.
 *
 * Delegates for raster tile generation and cache management. The Rust engine
 * handles tile rendering on background threads; JS only toggles generation
 * and inspects/clears the on-disk cache.
 */

import * as FileSystem from 'expo-file-system/legacy';
import type { DelegateHost } from './host';

/** Enable heatmap tile generation by setting the tiles path. */
export function enableHeatmapTiles(host: DelegateHost): void {
  const tilesPath = `${FileSystem.cacheDirectory}heatmap-tiles/`;
  const normalizedTilesPath = tilesPath.startsWith('file://') ? tilesPath.slice(7) : tilesPath;
  host.heatmapTilesPath = normalizedTilesPath;
  host.write('enableHeatmapTiles', () => {
    try {
      host.engine.heatmap().setTilesPath(normalizedTilesPath);
    } catch (e) {
      console.warn('[EngineClient] Failed to set heatmap tiles path:', e);
    }
  });
}

/** Disable heatmap tile generation by clearing the tiles path in the engine. */
export function disableHeatmapTiles(host: DelegateHost): void {
  // Forgotten here as well as cleared in the engine, or the next re-open would
  // turn it back on for an athlete who turned it off.
  host.heatmapTilesPath = null;
  host.write('disableHeatmapTiles', () => {
    try {
      host.engine.heatmap().clearTilesPath();
    } catch (e) {
      console.warn('[EngineClient] Failed to clear heatmap tiles path:', e);
    }
  });
}

/**
 * Stop the tile pass and the invalidation sweep, if either is running.
 *
 * Called before anything that makes their output worthless: turning the
 * heatmap off, or clearing the tiles. Both keep writing to disk otherwise, and
 * a pass that finishes after a clear puts back the tiles the clear took.
 * Returns whether there was anything to stop.
 */
export function cancelHeatmapWork(host: DelegateHost): boolean {
  if (!host.ready) return false;
  try {
    return host.engine.heatmap().cancel();
  } catch (e) {
    console.warn('[EngineClient] Failed to cancel heatmap work:', e);
    return false;
  }
}

/**
 * Get total size of heatmap tile cache in bytes (fast native scan).
 *
 * Blocking, and linear in cached tiles: 40,061 of them measured 170 ms on the
 * CPH2653, past the 100 ms a mount has for the whole screen. Anything on a
 * mount path uses `startHeatmapCacheSize` and `pollHeatmapCacheSize`.
 */
export function getHeatmapCacheSize(host: DelegateHost, basePath: string): number {
  if (!host.ready) return 0;
  return Number(
    host.timed('getHeatmapCacheSize', () =>
      host.engine.heatmap().getCacheSize(nativePath(basePath))
    )
  );
}

/**
 * Start the cache-size walk on its own thread. Poll it with
 * `pollHeatmapCacheSize`.
 *
 * Starting one while a walk is already running joins that walk rather than
 * beginning a second, so three mount effects asking at once cost one pass.
 */
export function startHeatmapCacheSize(host: DelegateHost, basePath: string): void {
  if (!host.ready) return;
  host.timed('startHeatmapCacheSize', () =>
    host.engine.heatmap().startCacheSize(nativePath(basePath))
  );
}

/** What one poll of the walk says. `bytes` is meaningful only when complete. */
export interface HeatmapCacheSizePoll {
  state: 'idle' | 'running' | 'complete';
  bytes: number;
}

/** Poll the running cache-size walk. */
export function pollHeatmapCacheSize(host: DelegateHost): HeatmapCacheSizePoll {
  if (!host.ready) return { state: 'idle', bytes: 0 };
  const poll = host.timed('pollHeatmapCacheSize', () => host.engine.heatmap().pollCacheSize());
  return { state: poll.state as HeatmapCacheSizePoll['state'], bytes: Number(poll.bytes) };
}

/** Rust wants a filesystem path, and expo hands out `file://` URLs. */
function nativePath(basePath: string): string {
  return basePath.startsWith('file://') ? basePath.slice(7) : basePath;
}

/** Clear all heatmap tiles from disk. */
export function clearHeatmapTiles(host: DelegateHost, basePath: string): number {
  if (!host.ready) return 0;
  // Normalize file:// URLs - Rust expects plain filesystem paths
  const normalizedPath = basePath.startsWith('file://') ? basePath.slice(7) : basePath;
  return host.timed('clearHeatmapTiles', () => host.engine.heatmap().clearTiles(normalizedPath));
}

/** Get heatmap tile generation progress: [processed, total] */
export function getHeatmapTileProgress(host: DelegateHost): number[] | null {
  if (!host.ready) return null;
  try {
    return host.engine.heatmap().getProgress();
  } catch {
    return null;
  }
}

/** Poll tile generation status: 'idle' | 'running' | 'complete' */
export function pollTileGeneration(host: DelegateHost): string {
  if (!host.ready) return 'idle';
  try {
    return host.engine.heatmap().poll();
  } catch {
    return 'error';
  }
}
