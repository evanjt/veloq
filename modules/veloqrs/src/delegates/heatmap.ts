/**
 * Heatmap tile delegates.
 *
 * Delegates for raster tile generation and cache management. The Rust engine
 * handles tile rendering on background threads; JS only toggles generation
 * and inspects/clears the on-disk cache.
 */

import * as FileSystem from 'expo-file-system/legacy';
import type { DelegateHost } from './host';

/**
 * Where tiles go, with the `file://` the engine cannot open stripped off.
 *
 * The launch bundle hands this to Rust as an argument rather than calling the
 * toggle, so both have to arrive at the same path.
 */
export function heatmapTilesPath(): string {
  const tilesPath = `${FileSystem.cacheDirectory}heatmap-tiles/`;
  return tilesPath.startsWith('file://') ? tilesPath.slice(7) : tilesPath;
}

/** Enable heatmap tile generation by setting the tiles path. */
export function enableHeatmapTiles(host: DelegateHost): void {
  const normalizedTilesPath = heatmapTilesPath();
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
 * Tell the engine which ground the athlete is looking at.
 *
 * The tile pass writes every zoom in full before the next, so on a fresh
 * install the tiles under an open map are behind the whole lower sweep. The
 * camera steers the order of the next pass to plan. Cheap and lock-free, so a
 * settled camera may call it every time.
 */
export function setHeatmapPriorityView(
  host: DelegateHost,
  latitude: number,
  longitude: number,
  zoom: number
): void {
  if (!host.ready) return;
  try {
    host.timed('setPriorityView', () =>
      host.engine.heatmap().setPriorityView(latitude, longitude, Math.round(zoom))
    );
  } catch (e) {
    console.warn('[EngineClient] Failed to set the heatmap priority view:', e);
  }
}

/** Forget it, when no map is open on any particular ground. */
export function clearHeatmapPriorityView(host: DelegateHost): void {
  if (!host.ready) return;
  try {
    host.timed('clearPriorityView', () => host.engine.heatmap().clearPriorityView());
  } catch (e) {
    console.warn('[EngineClient] Failed to clear the heatmap priority view:', e);
  }
}

/**
 * Stop the tile pass and the invalidation sweep, if either is running.
 *
 * Called when their output stops being wanted, as when the heatmap is turned
 * off, so neither holds a core for it. It does not make a clear safe: a pass
 * saves the tile it has in flight after a cancel, which is why
 * `clearHeatmapTiles` stops the pass and waits for it itself.
 * Returns whether there was anything to stop.
 */
export function cancelHeatmapWork(host: DelegateHost): boolean {
  if (!host.ready) return false;
  try {
    return host.timed('cancel', () => host.engine.heatmap().cancel());
  } catch (e) {
    console.warn('[EngineClient] Failed to cancel heatmap work:', e);
    return false;
  }
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

/**
 * Stop any tile pass, then clear every heatmap tile under `basePath`.
 *
 * On a Rust thread: the stop waits out a pass that is drawing, and the walk is
 * tens of thousands of files. Rejects when a tile could not be removed, since
 * that is heat still on disk, and when there is no engine to do it.
 */
export async function clearHeatmapTiles(host: DelegateHost, basePath: string): Promise<void> {
  if (!host.ready) throw new Error('The engine is not open, so no heatmap tile was cleared');
  await host.engine.heatmap().clearTiles(nativePath(basePath));
}

/** Get heatmap tile generation progress: [processed, total] */
export function getHeatmapTileProgress(host: DelegateHost): number[] | null {
  if (!host.ready) return null;
  return host.timed('getProgress', () => host.engine.heatmap().getProgress());
}

/** Poll tile generation status: 'idle' | 'running' | 'complete' */
export function pollTileGeneration(host: DelegateHost): string {
  if (!host.ready) return 'idle';
  try {
    return host.timed('poll', () => host.engine.heatmap().poll());
  } catch {
    return 'error';
  }
}
