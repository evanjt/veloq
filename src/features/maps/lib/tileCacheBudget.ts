/**
 * How much device storage the four tile caches may hold, and the eviction
 * that enforces it.
 *
 * The budget used to be a literal inside two WebView scripts over the same
 * three caches, so the interactive surfaces and the snapshot worker could
 * disagree about when to evict from a cache they share. It is one constant
 * here, interpolated into both pages at build time.
 */

/** The Cache API stores the map pages write to. */
export const TILE_CACHE_NAMES = [
  'veloq-vector-v1',
  'veloq-terrain-dem-v1',
  'veloq-ground-v1',
] as const;

/**
 * Satellite imagery used to have a cache of its own and the largest share of
 * the budget. It is no longer kept: offline the map falls back to the vector
 * basemap, so imagery the athlete cannot reach with the radio off would only
 * spend the pool that basemap needs. The name survives so an install that
 * still holds one can be told to drop it.
 */
export const LEGACY_SATELLITE_CACHE = 'veloq-satellite-v1';

export type TileCacheName = (typeof TILE_CACHE_NAMES)[number];

/**
 * The split between them, in the 50/30/10 proportions of the 120/50/30 MB that
 * shipped, with satellite's old 110 MB redistributed across the three that are
 * still kept. The stated total is what the store may hold, so the shares have
 * to spend all of it or the setting overstates the ceiling by more than half.
 * Vector tiles take most of it: they are small, they cover far more ground per
 * byte, and offline they are now the only basemap there is.
 */
const SHARES: Record<TileCacheName, number> = {
  'veloq-vector-v1': 50 / 90,
  'veloq-terrain-dem-v1': 30 / 90,
  'veloq-ground-v1': 10 / 90,
};

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

/** Bytes each cache may hold at a given total. */
export function tileCacheBudgets(totalMb: number): Record<TileCacheName, number> {
  const total = clampTileCacheBudgetMb(totalMb) * 1024 * 1024;
  const terrain = Math.round(total * SHARES['veloq-terrain-dem-v1']);
  const ground = Math.round(total * SHARES['veloq-ground-v1']);
  return {
    // Vector takes the remainder rather than its own rounding, so three
    // rounded shares still sum to exactly the ceiling the athlete was shown.
    'veloq-vector-v1': total - terrain - ground,
    'veloq-terrain-dem-v1': terrain,
    'veloq-ground-v1': ground,
  };
}

/**
 * The eviction pass both pages carry: FIFO by cache order, checked every 50
 * inserts, plus `window._veloqSetCacheBudgets` so a lowered setting evicts now
 * rather than at the next fiftieth tile.
 */
export function cacheEvictionScript(totalMb: number = DEFAULT_TILE_CACHE_BUDGET_MB): string {
  const budgets = tileCacheBudgets(totalMb);
  const literal = TILE_CACHE_NAMES.map((name) => `      '${name}': ${budgets[name]},`).join('\n');
  return `
    // An install from before imagery stopped being kept still holds a
    // satellite cache, which nothing reads, nothing evicts and no budget
    // bounds. Dropping it is idempotent and costs nothing once it is gone.
    // A cleanup must never be what stops the map drawing, so it is guarded.
    try { caches.delete('${LEGACY_SATELLITE_CACHE}'); } catch (e) {}

    // Cache eviction - FIFO, size-based. Checked every 50 inserts per cache.
    var _insertCounts = {};
    var CACHE_BUDGETS = {
${literal}
    };

    function evictNow(cacheName) {
      var budget = CACHE_BUDGETS[cacheName];
      if (!budget) return;
      caches.open(cacheName).then(function(cache) {
        cache.keys().then(function(requests) {
          var sizes = requests.map(function(req) {
            return cache.match(req).then(function(r) {
              if (!r) return { req: req, size: 0 };
              var cl = parseInt(r.headers.get('content-length') || '0', 10) || 0;
              if (cl > 0) return { req: req, size: cl };
              return r.arrayBuffer().then(function(buf) {
                return { req: req, size: buf.byteLength };
              });
            });
          });
          Promise.all(sizes).then(function(entries) {
            var total = entries.reduce(function(s, e) { return s + e.size; }, 0);
            if (total <= budget) return;
            for (var i = 0; i < entries.length && total > budget; i++) {
              cache.delete(entries[i].req);
              total -= entries[i].size;
            }
          });
        });
      });
    }

    function maybeEvict(cacheName) {
      _insertCounts[cacheName] = (_insertCounts[cacheName] || 0) + 1;
      if (_insertCounts[cacheName] % 50 !== 0) return;
      evictNow(cacheName);
    }

    // A lowered ceiling has to bite immediately. Waiting for the next fiftieth
    // insert leaves the athlete looking at the size they just asked to shrink.
    window._veloqSetCacheBudgets = function(budgets) {
      CACHE_BUDGETS = budgets;
      for (var name in budgets) evictNow(name);
    };
`;
}

/** Injected into a live page when the setting changes. */
export function applyTileCacheBudgetScript(totalMb: number): string {
  return `
    (function() {
      if (window._veloqSetCacheBudgets) {
        window._veloqSetCacheBudgets(${JSON.stringify(tileCacheBudgets(totalMb))});
      }
    })();
    true;
  `;
}

/**
 * Drop every tile cache. Injected into a live page when the athlete clears the
 * caches from settings. Driven by `TILE_CACHE_NAMES` so a cache added later
 * cannot be the one the clear misses.
 */
export function clearTileCachesScript(): string {
  const deletes = TILE_CACHE_NAMES.map((name) => `caches.delete('${name}')`).join(
    ',\n            '
  );
  return `
          Promise.all([
            ${deletes},
          ]).then(function() {
            window._rn_log('All tile caches cleared');
            window._currentBaseStyle = null;
          });
          true;
        `;
}

/**
 * Measure every tile cache and post the totals back as `tileCacheStats`. The
 * per-kind buckets are what the storage panel draws, so a cache with no bucket
 * would count toward the total and appear in no segment.
 */
export function tileCacheStatsScript(): string {
  return `
          (function() {
            var cacheNames = ${JSON.stringify([...TILE_CACHE_NAMES])};
            Promise.all(cacheNames.map(function(name) {
              return caches.open(name).then(function(cache) {
                return cache.keys().then(function(requests) {
                  return Promise.all(requests.map(function(req) {
                    return cache.match(req).then(function(r) {
                      return r ? (parseInt(r.headers.get('content-length') || '0', 10) || 0) : 0;
                    });
                  })).then(function(sizes) {
                    var total = 0;
                    for (var i = 0; i < sizes.length; i++) total += sizes[i];
                    return { name: name, tileCount: requests.length, totalBytes: total };
                  });
                });
              }).catch(function() { return { name: name, tileCount: 0, totalBytes: 0 }; });
            })).then(function(results) {
              var combined = { tileCount: 0, totalBytes: 0, terrain: null, vector: null, ground: null };
              results.forEach(function(r) {
                combined.tileCount += r.tileCount;
                combined.totalBytes += r.totalBytes;
                var bucket = { tileCount: r.tileCount, totalBytes: r.totalBytes };
                if (r.name.indexOf('terrain') >= 0) combined.terrain = bucket;
                else if (r.name.indexOf('vector') >= 0) combined.vector = bucket;
                else if (r.name.indexOf('ground') >= 0) combined.ground = bucket;
              });
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'tileCacheStats', workerId: window._workerId,
                tileCount: combined.tileCount, totalBytes: combined.totalBytes,
                terrain: combined.terrain, vector: combined.vector,
                ground: combined.ground,
              }));
            });
          })();
          true;
        `;
}
