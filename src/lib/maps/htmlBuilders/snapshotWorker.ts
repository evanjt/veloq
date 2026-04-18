/**
 * HTML builder for a single terrain snapshot worker WebView
 * (`TerrainSnapshotWebView` pool member).
 *
 * Produces the full `<!DOCTYPE html>` string loaded into each worker, with
 * the worker's ID baked in so messages posted back to React Native can be
 * routed to the correct handler. The generated HTML is byte-equivalent to the
 * inline `generateWorkerHtml(id)` template that used to live in
 * `TerrainSnapshotWebView.tsx`, modulo a `<title>` element introduced by the
 * shared `mapLibreHead(...)` helper (inert in WebViews).
 *
 * Kept as a pure function so callers can memoize it off the worker list.
 */
import { consoleBridgeScript, mapLibreHead } from './shared';

/**
 * Snapshot viewport height in CSS pixels. Mirrors the value in
 * `TerrainSnapshotWebView` — kept here so the builder stays self-contained
 * and can be called without the container's module state.
 */
const SNAPSHOT_HEIGHT = 240;

/**
 * Build the complete HTML string for a terrain snapshot worker WebView.
 *
 * The `workerId` is embedded directly into the page so postMessage
 * payloads can be routed back to the matching `WorkerState` on the JS side.
 */
export function buildSnapshotWorkerHtml(workerId: number): string {
  return `${mapLibreHead({ title: 'Snapshot Worker', mapHeight: `${SNAPSHOT_HEIGHT}px` })}
<body>
  <div id="map"></div>
  <script>
    // Worker identity — used to route messages back to the correct handler
    window._workerId = ${workerId};

    // Bridge console to React Native
    ${consoleBridgeScript({ workerId: 'window._workerId' })}

    // Generation counter for race condition guard
    window._snapshotGen = 0;

    // Track current base style for reuse optimisation
    window._currentBaseStyle = null;

    // Decode ArrayBuffer/Blob into HTMLImageElement via Object URL.
    // MapLibre v5 uses it directly (instanceof HTMLImageElement check),
    // bypassing arrayBufferToCanvasImageSource → createImageBitmap
    // which fails silently in Android WebView.
    function demBlobToImage(blob) {
      return new Promise(function(resolve, reject) {
        var url = URL.createObjectURL(blob);
        var img = new Image();
        img.onload = function() {
          URL.revokeObjectURL(url);
          resolve({ data: img });
        };
        img.onerror = function() {
          URL.revokeObjectURL(url);
          reject(new Error('DEM image decode failed'));
        };
        img.src = url;
      });
    }

    // Cache terrain DEM tiles via Cache API — persists across snapshot requests.
    // MapLibre v5.19.0 uses promise-based addProtocol.
    var TERRAIN_CACHE = 'veloq-terrain-dem-v1';

    function fetchWithRetry(url, retries, delay) {
      return fetch(url).catch(function(err) {
        if (retries <= 0) throw err;
        window._rn_log('DEM fetch retry (' + retries + ' left) for ' + url.split('/').slice(-3).join('/') + ': ' + err.message);
        return new Promise(function(resolve) { setTimeout(resolve, delay); })
          .then(function() { return fetchWithRetry(url, retries - 1, delay * 2); });
      });
    }

    maplibregl.addProtocol('cached-terrain', function(params) {
      var realUrl = 'https://' + params.url.substring('cached-terrain://'.length);
      return caches.open(TERRAIN_CACHE).then(function(cache) {
        return cache.match(realUrl).then(function(cached) {
          if (cached) {
            return cached.blob().then(demBlobToImage);
          }
          return fetchWithRetry(realUrl, 2, 300).then(function(r) {
            window._rn_log('DEM fetch ' + r.status + ': ' + realUrl.split('/').slice(-3).join('/'));
            if (!r.ok) throw new Error('HTTP ' + r.status);
            cache.put(realUrl, r.clone()); maybeEvict(TERRAIN_CACHE);
            return r.blob().then(demBlobToImage);
          });
        });
      }).catch(function(err) {
        window._rn_log('DEM error: ' + err.message + ' url=' + realUrl.split('/').slice(-3).join('/'));
        throw err;
      });
    });

    // Cache satellite tiles via Cache API — same pattern as terrain DEM tiles.
    var SATELLITE_CACHE = 'veloq-satellite-v1';
    maplibregl.addProtocol('cached-satellite', function(params) {
      var realUrl = 'https://' + params.url.substring('cached-satellite://'.length);
      return caches.open(SATELLITE_CACHE).then(function(cache) {
        return cache.match(realUrl).then(function(cached) {
          if (cached) {
            return cached.blob().then(demBlobToImage);
          }
          return fetch(realUrl).then(function(r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            cache.put(realUrl, r.clone()); maybeEvict(SATELLITE_CACHE);
            return r.blob().then(demBlobToImage);
          });
        });
      });
    });

    // Cache vector tiles (protocol buffers) via Cache API.
    var VECTOR_CACHE = 'veloq-vector-v1';
    maplibregl.addProtocol('cached-vector', function(params) {
      var realUrl = 'https://' + params.url.substring('cached-vector://'.length);
      return caches.open(VECTOR_CACHE).then(function(cache) {
        return cache.match(realUrl).then(function(cached) {
          if (cached) return cached.arrayBuffer().then(function(d) { return { data: d }; });
          return fetch(realUrl).then(function(r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            cache.put(realUrl, r.clone()); maybeEvict(VECTOR_CACHE);
            return r.arrayBuffer().then(function(d) { return { data: d }; });
          });
        });
      });
    });

    // Cache eviction — FIFO, size-based. Checked every 50 inserts per cache.
    var _insertCounts = {};
    var CACHE_BUDGETS = {
      'veloq-satellite-v1': 120 * 1024 * 1024,
      'veloq-vector-v1': 50 * 1024 * 1024,
      'veloq-terrain-dem-v1': 30 * 1024 * 1024,
    };

    function maybeEvict(cacheName) {
      _insertCounts[cacheName] = (_insertCounts[cacheName] || 0) + 1;
      if (_insertCounts[cacheName] % 50 !== 0) return;
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

    window._rn_log('Initializing MapLibre (worker ${workerId})...');

    window.map = new maplibregl.Map({
      container: 'map',
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: [8.5, 47.3],
      zoom: 10,
      pitch: 60,
      attributionControl: false,
      antialias: true,
      canvasContextAttributes: {
        preserveDrawingBuffer: true,
      },
      pixelRatio: window.devicePixelRatio || 2,
    });

    window.map.on('load', function() {
      window._rn_log('Map loaded OK (worker ${workerId})');
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'mapReady',
          workerId: window._workerId,
        }));
      }
    });

    window._tileErrorCount = 0;

    window.map.on('error', function(e) {
      var msg = e.error ? e.error.message : JSON.stringify(e);
      // Only count server errors (429, 5xx) and network failures as tile errors.
      // 404s are expected from regional satellite sources (swisstopo, eox, ign)
      // that return 404 for tiles outside their coverage area.
      var status = e.error && e.error.status;
      if (status === 404 || /HTTP 404/.test(msg)) return;
      window._rn_log('Map error: ' + msg);
      if (e.sourceId || (e.error && (status >= 400 || /tile|source|fetch|network|load/i.test(msg)))) {
        window._tileErrorCount++;
      }
    });

    // Track tile loading progress per source
    window._tileStats = {};

    window.map.on('data', function(e) {
      if (e.dataType === 'source' && e.sourceId && e.tile) {
        if (!window._tileStats[e.sourceId]) {
          window._tileStats[e.sourceId] = { loaded: 0, total: 0 };
        }
        window._tileStats[e.sourceId].loaded++;
        var s = window._tileStats[e.sourceId];
        if (s.loaded % 5 === 0 || s.loaded <= 2) {
          window._rn_log('Tiles [' + e.sourceId + ']: ' + s.loaded + ' loaded');
        }
      }
    });

    window.map.on('dataloading', function(e) {
      if (e.dataType === 'source' && e.sourceId) {
        if (!window._tileStats[e.sourceId]) {
          window._tileStats[e.sourceId] = { loaded: 0, total: 0 };
        }
        window._tileStats[e.sourceId].total++;
      }
    });

    // rAF heartbeat — confirms rendering loop is alive
    var _rafCount = 0;
    function rafHeartbeat() {
      _rafCount++;
      requestAnimationFrame(rafHeartbeat);
    }
    requestAnimationFrame(rafHeartbeat);
  </script>
</body>
</html>`;
}
