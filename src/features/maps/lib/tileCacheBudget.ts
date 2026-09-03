/**
 * How much device storage the four tile caches may hold, and the eviction
 * that enforces it.
 *
 * The budget used to be a literal inside two WebView scripts over the same
 * three caches, so the interactive surfaces and the snapshot worker could
 * disagree about when to evict from a cache they share. It is one constant
 * here, interpolated into both pages at build time (`B123`, `Q23`).
 */

/** The Cache API stores the map pages write to. */
export const TILE_CACHE_NAMES = [
  'veloq-satellite-v1',
  'veloq-vector-v1',
  'veloq-terrain-dem-v1',
  'veloq-ground-v1',
] as const;

export type TileCacheName = (typeof TILE_CACHE_NAMES)[number];

/**
 * The split between them, from the 120/50/30 MB that shipped, with the light
 * style's ground raster carved out of the satellite share. Satellite tiles are
 * images and dominate, vector tiles are small and cover far more ground per
 * byte, the DEM is only fetched for the 3D surfaces, and the ground raster
 * stops at zoom 6, so its whole pyramid is smaller than one city of satellite.
 */
const SHARES: Record<TileCacheName, number> = {
  'veloq-satellite-v1': 0.55,
  'veloq-vector-v1': 0.25,
  'veloq-terrain-dem-v1': 0.15,
  'veloq-ground-v1': 0.05,
};

/** What every install had before the setting existed. */
export const DEFAULT_TILE_CACHE_BUDGET_MB = 200;

/** What the settings row offers. */
export const TILE_CACHE_BUDGET_CHOICES_MB = [100, 200, 400, 800];

export function clampTileCacheBudgetMb(value: unknown): number {
  return typeof value === 'number' && TILE_CACHE_BUDGET_CHOICES_MB.includes(value)
    ? value
    : DEFAULT_TILE_CACHE_BUDGET_MB;
}

/** Bytes each cache may hold at a given total. */
export function tileCacheBudgets(totalMb: number): Record<TileCacheName, number> {
  const total = clampTileCacheBudgetMb(totalMb) * 1024 * 1024;
  return {
    'veloq-satellite-v1': Math.round(total * SHARES['veloq-satellite-v1']),
    'veloq-vector-v1': Math.round(total * SHARES['veloq-vector-v1']),
    'veloq-terrain-dem-v1': Math.round(total * SHARES['veloq-terrain-dem-v1']),
    'veloq-ground-v1': Math.round(total * SHARES['veloq-ground-v1']),
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
              var combined = { tileCount: 0, totalBytes: 0, terrain: null, satellite: null, vector: null, ground: null };
              results.forEach(function(r) {
                combined.tileCount += r.tileCount;
                combined.totalBytes += r.totalBytes;
                var bucket = { tileCount: r.tileCount, totalBytes: r.totalBytes };
                if (r.name.indexOf('terrain') >= 0) combined.terrain = bucket;
                else if (r.name.indexOf('satellite') >= 0) combined.satellite = bucket;
                else if (r.name.indexOf('vector') >= 0) combined.vector = bucket;
                else if (r.name.indexOf('ground') >= 0) combined.ground = bucket;
              });
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'tileCacheStats', workerId: window._workerId,
                tileCount: combined.tileCount, totalBytes: combined.totalBytes,
                terrain: combined.terrain, satellite: combined.satellite,
                vector: combined.vector, ground: combined.ground,
              }));
            });
          })();
          true;
        `;
}
