/**
 * Inline JavaScript snippets shared between WebView HTML builders
 * (`buildMap3DHtml`, `buildSnapshotWorkerHtml`). Keeping them here as
 * string exports lets each builder compose its template from the same
 * primitives without runtime overhead or duplication.
 */

/**
 * Bridges calls to `window._rn_log(msg)` to React Native via postMessage.
 * Receivers should handle `{ type: 'console', message: string }` messages.
 * Optionally also carries `workerId` when building worker-style WebViews.
 */
export function consoleBridgeScript(options: { workerId?: string } = {}): string {
  const workerField = options.workerId ? `, workerId: ${options.workerId}` : '';
  return `
    window._rn_log = function(msg) {
      try {
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'console',
            message: String(msg)${workerField}
          }));
        }
      } catch (e) {}
    };
  `;
}

/**
 * Registers the `cached-terrain`, `cached-satellite`, `cached-vector` and
 * `heatmap-file` protocols on `maplibregl`.
 *
 * The three cache protocols back onto the Cache API keyed off the stable
 * `https://veloq.fit/` base URL, so tiles survive a WebView being recreated.
 * Eviction is FIFO and size-capped, checked every 50 inserts per cache.
 * `heatmap-file` round-trips to React Native, which reads the PNG off disk.
 *
 * Defines `terrainHits`/`terrainMisses`, `satHits`/`satMisses` and
 * `vecHits`/`vecMisses` counters that callers may log.
 */
export function tileProtocolsScript(): string {
  return `
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

    // Cache eviction - FIFO, size-based. Checked every 50 inserts per cache.
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
              var cl = parseInt(r.headers.get('content-length') || '0') || 0;
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

    var TERRAIN_CACHE = 'veloq-terrain-dem-v1';
    var terrainHits = 0, terrainMisses = 0;
    maplibregl.addProtocol('cached-terrain', function(params) {
      var realUrl = 'https://' + params.url.substring('cached-terrain://'.length);
      return caches.open(TERRAIN_CACHE).then(function(cache) {
        return cache.match(realUrl).then(function(cached) {
          if (cached) {
            terrainHits++;
            return cached.blob().then(demBlobToImage);
          }
          terrainMisses++;
          return fetch(realUrl).then(function(r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            cache.put(realUrl, r.clone()); maybeEvict(TERRAIN_CACHE);
            return r.blob().then(demBlobToImage);
          });
        });
      }).catch(function(err) {
        window._rn_log('terrain protocol error: ' + err.message);
        throw err;
      });
    });

    var SATELLITE_CACHE = 'veloq-satellite-v1';
    var satHits = 0, satMisses = 0;
    maplibregl.addProtocol('cached-satellite', function(params) {
      var realUrl = 'https://' + params.url.substring('cached-satellite://'.length);
      return caches.open(SATELLITE_CACHE).then(function(cache) {
        return cache.match(realUrl).then(function(cached) {
          if (cached) { satHits++; return cached.blob().then(demBlobToImage); }
          satMisses++;
          return fetch(realUrl).then(function(r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            cache.put(realUrl, r.clone()); maybeEvict(SATELLITE_CACHE);
            return r.blob().then(demBlobToImage);
          });
        });
      });
    });

    var VECTOR_CACHE = 'veloq-vector-v1';
    var vecHits = 0, vecMisses = 0;
    maplibregl.addProtocol('cached-vector', function(params) {
      var realUrl = 'https://' + params.url.substring('cached-vector://'.length);
      return caches.open(VECTOR_CACHE).then(function(cache) {
        return cache.match(realUrl).then(function(cached) {
          if (cached) { vecHits++; return cached.arrayBuffer().then(function(d) { return { data: d }; }); }
          vecMisses++;
          return fetch(realUrl).then(function(r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            cache.put(realUrl, r.clone()); maybeEvict(VECTOR_CACHE);
            return r.arrayBuffer().then(function(d) { return { data: d }; });
          });
        });
      });
    });

    window._heatmapRequests = {};
    maplibregl.addProtocol('heatmap-file', function(params) {
      var tilePath = params.url.replace('heatmap-file://', '');
      return new Promise(function(resolve, reject) {
        var requestId = '_ht_' + Date.now() + '_' + Math.random().toString(36).substr(2);
        window._heatmapRequests[requestId] = { resolve: resolve, reject: reject };
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'heatmapTileRequest',
          requestId: requestId,
          tilePath: tilePath
        }));
        setTimeout(function() {
          if (window._heatmapRequests[requestId]) {
            delete window._heatmapRequests[requestId];
            reject(new Error('heatmap tile timeout'));
          }
        }, 10000);
      });
    });
  `;
}

/**
 * Standard HTML head: MapLibre GL JS, inline CSS for full-bleed map.
 * `mapHeight` defaults to `100vh`; pass a pixel value for fixed-height workers.
 */
export function mapLibreHead(options: { title?: string; mapHeight?: string } = {}): string {
  const height = options.mapHeight ?? '100vh';
  const title = options.title ?? 'Map';
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>${title}</title>
  <script src="https://unpkg.com/maplibre-gl@5.19.0/dist/maplibre-gl.js"></script>
  <link href="https://unpkg.com/maplibre-gl@5.19.0/dist/maplibre-gl.css" rel="stylesheet" />
  <style>
    body { margin: 0; padding: 0; overflow: hidden; }
    #map { width: 100vw; height: ${height}; }
  </style>
</head>`;
}
