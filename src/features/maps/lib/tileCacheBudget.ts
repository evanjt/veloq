/**
 * How much device storage the three tile caches may hold, and the eviction
 * that enforces it.
 *
 * The budget used to be a literal inside two WebView scripts over the same
 * three caches, so the interactive surfaces and the snapshot worker could
 * disagree about when to evict from a cache they share. It is one constant
 * here, interpolated into both pages at build time (`B123`, `Q23`).
 */

/** The three Cache API stores the map pages write to. */
export const TILE_CACHE_NAMES = [
  'veloq-satellite-v1',
  'veloq-vector-v1',
  'veloq-terrain-dem-v1',
] as const;

export type TileCacheName = (typeof TILE_CACHE_NAMES)[number];

/**
 * The split between them, from the 120/50/30 MB that shipped. Satellite tiles
 * are images and dominate, vector tiles are small and cover far more ground per
 * byte, and the DEM is only fetched for the 3D surfaces.
 */
const SHARES: Record<TileCacheName, number> = {
  'veloq-satellite-v1': 0.6,
  'veloq-vector-v1': 0.25,
  'veloq-terrain-dem-v1': 0.15,
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
