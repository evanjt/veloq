/**
 * The athlete's tile storage ceiling and its ladder of choices, and the Cache
 * API buckets earlier builds left on the pages.
 *
 * The ceiling bounds the Rust tile store, which every tile goes through
 * (`applyBasemapBudget`). The pages keep no tile cache of their own, so the
 * bucket names here exist to be dropped and measured.
 */

/** The Cache API stores earlier builds wrote the map pages' tiles to. */
export const TILE_CACHE_NAMES = ['veloq-vector-v1', 'veloq-ground-v1'] as const;

/**
 * Satellite imagery used to have a cache of its own and the largest share of
 * the budget. It is no longer kept: offline the map falls back to the vector
 * basemap, so imagery the athlete cannot reach with the radio off would only
 * spend the pool that basemap needs. The name survives so an install that
 * still holds one can be told to drop it.
 */
export const LEGACY_SATELLITE_CACHE = 'veloq-satellite-v1';

/**
 * The terrain DEM had a bucket of its own until the intercept took the DEM
 * and the Rust store became the one tier that keeps it. A page that still
 * held one would be a second DEM cache Rust can neither see nor evict from,
 * so the name survives only to be dropped.
 */
export const LEGACY_TERRAIN_CACHE = 'veloq-terrain-dem-v1';

export type TileCacheName = (typeof TILE_CACHE_NAMES)[number];

/**
 * One pool for the whole store. This is the number the athlete was always told
 * the cache defaulted to; every install in fact ran at 200 MB, four times it.
 */
export const DEFAULT_TILE_CACHE_BUDGET_MB = 50;

/** What the settings row offers. The default is the first rung, not the middle. */
export const TILE_CACHE_BUDGET_CHOICES_MB = [50, 100, 200, 400];

/**
 * The stored ceiling, snapped onto the ladder.
 *
 * An install carrying 800, which the ladder no longer offers, asked for as
 * much room as it could get, so it comes down one rung rather than all the way
 * to the default: dropping it to 50 would scrub 750 MB of tiles the athlete
 * deliberately kept. Junk that was never a ceiling takes the default instead.
 */
export function clampTileCacheBudgetMb(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_TILE_CACHE_BUDGET_MB;
  }
  const rungs = [...TILE_CACHE_BUDGET_CHOICES_MB].sort((a, b) => a - b);
  const atOrBelow = rungs.filter((rung) => rung <= value);
  return atOrBelow.length > 0 ? atOrBelow[atOrBelow.length - 1] : rungs[0];
}

/**
 * Deletes every bucket a page may still hold from earlier builds, which kept
 * vector, ground, satellite and terrain tiles beside the Rust store where
 * nothing could size or evict them. Idempotent, and guarded: a cleanup must
 * never be what stops the map drawing.
 */
export function dropRetiredTileCachesScript(): string {
  const names = [...TILE_CACHE_NAMES, LEGACY_SATELLITE_CACHE, LEGACY_TERRAIN_CACHE];
  return names.map((name) => `    try { caches.delete('${name}'); } catch (e) {}`).join('\n');
}
