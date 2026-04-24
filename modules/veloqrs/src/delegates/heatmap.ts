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
  if (!host.ready) return;
  const tilesPath = `${FileSystem.cacheDirectory}heatmap-tiles/`;
  const normalizedTilesPath = tilesPath.startsWith('file://') ? tilesPath.slice(7) : tilesPath;
  try {
    host.engine.heatmap().setTilesPath(normalizedTilesPath);
  } catch (e) {
    console.warn('[RouteEngineClient] Failed to set heatmap tiles path:', e);
  }
}

/** Disable heatmap tile generation by clearing the tiles path in the engine. */
export function disableHeatmapTiles(host: DelegateHost): void {
  if (!host.ready) return;
  try {
    host.engine.heatmap().clearTilesPath();
  } catch (e) {
    console.warn('[RouteEngineClient] Failed to clear heatmap tiles path:', e);
  }
}

/** Get total size of heatmap tile cache in bytes (fast native scan). */
export function getHeatmapCacheSize(host: DelegateHost, basePath: string): number {
  if (!host.ready) return 0;
  const normalizedPath = basePath.startsWith('file://') ? basePath.slice(7) : basePath;
  return Number(
    host.timed('getHeatmapCacheSize', () => host.engine.heatmap().getCacheSize(normalizedPath))
  );
}

/** Clear all heatmap tiles from disk. */
export function clearHeatmapTiles(host: DelegateHost, basePath: string): number {
  if (!host.ready) return 0;
  // Normalize file:// URLs — Rust expects plain filesystem paths
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
