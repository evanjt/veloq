/**
 * The Rust basemap store as the cache settings reach it: the athlete's tile
 * limit and the figures the cache screen draws.
 *
 * On both handsets every kept basemap tile goes through the native intercept
 * into this store, so it is the one the limit has to bound and the one the
 * cache screen has to measure. Both calls are async on the Rust side, because
 * each can walk or delete thousands of files.
 */
import type { LIBERTY_SOURCES } from '@/features/maps/styles/liberty/sources';
import { debug } from '@/shared/debug/debug';

import { clampTileCacheBudgetMb } from './tileCacheBudget';

const log = debug.create('BasemapCache');

/** The source the vector basemap is stored under, which is the style's own key. */
const VECTOR_SOURCE: keyof typeof LIBERTY_SOURCES = 'openmaptiles';

/**
 * The store, or null where there is no native module, which is the test bench
 * and the web.
 */
function basemapStore(): import('veloqrs').BasemapManager | null {
  try {
    // Required lazily, not imported: `veloqrs` reaches the Turbo Module at
    // import time, and the settings store this is called from is loaded in
    // tests and on web, where that module does not exist.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { basemapStore } = require('veloqrs') as typeof import('veloqrs');
    return basemapStore();
  } catch {
    return null;
  }
}

/** Bytes in one megabyte of the tile limit, decimal like every storage figure shown. */
export const BYTES_PER_BUDGET_MB = 1_000_000;

/** The tile limit in bytes, clamped onto the ladder the way the setting is. */
export function basemapBudgetBytes(mb: number): number {
  return clampTileCacheBudgetMb(mb) * BYTES_PER_BUDGET_MB;
}

/**
 * Hand the store the athlete's tile limit. It keeps it, evicts down to it at
 * once and holds every later tile to it. Quiet on failure: the setting is
 * still the athlete's, and the store takes it at the next launch.
 */
export async function applyBasemapBudget(mb: number): Promise<void> {
  const store = basemapStore();
  if (!store) return;
  try {
    await store.setBudget(basemapBudgetBytes(mb));
  } catch (e) {
    log.warn('the tile store did not take the limit:', e);
  }
}

/** What the store holds, in bytes. */
export interface BasemapTileSizes {
  totalBytes: number;
  /** The vector basemap. The rest is ground: the raster relief and the terrain DEM. */
  vectorBytes: number;
}

/** What the store holds, or null when it could not say. */
export async function readBasemapTileSizes(): Promise<BasemapTileSizes | null> {
  const store = basemapStore();
  if (!store) return null;
  try {
    const [total, vector] = await Promise.all([
      store.getCacheSize(),
      store.getSourceSize(VECTOR_SOURCE),
    ]);
    return { totalBytes: total, vectorBytes: vector };
  } catch (e) {
    log.warn('the tile store could not say what it holds:', e);
    return null;
  }
}

/**
 * Drop every opportunistic tile in the store and keep the pinned pre-seed,
 * which is the offline ground the athlete downloaded and not a cache. Quiet on
 * failure, so a store with no path set cannot stop the rest of a clear.
 */
export async function clearUnpinnedBasemapTiles(): Promise<void> {
  const store = basemapStore();
  if (!store) return;
  try {
    await store.clearUnpinnedTiles();
  } catch (e) {
    log.warn('the tile store did not clear:', e);
  }
}

/**
 * Hits, misses and fetches per source since start or the last reset, for the
 * Developer Dashboard. Empty where there is no store or the read fails.
 */
export function readBasemapTileCounts(): import('veloqrs').SourceTileCounts[] {
  try {
    return basemapStore()?.tileCounts() ?? [];
  } catch (e) {
    log.warn('the tile counters could not be read:', e);
    return [];
  }
}

/** Zero the store's hit, miss and fetch counters. Quiet where there is no store. */
export function resetBasemapTileCounts(): void {
  try {
    basemapStore()?.resetTileCounts();
  } catch (e) {
    log.warn('the tile counters did not reset:', e);
  }
}
