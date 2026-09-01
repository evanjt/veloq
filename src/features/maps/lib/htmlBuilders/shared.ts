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
 * The `cached-vector` protocol, one copy for the two pages that register it.
 *
 * The interactive surfaces and the snapshot worker both write to
 * `veloq-vector-v1`, so a body one stores is one the other serves and the
 * contract cannot hold in two places: `B117` was a defect in it and had to be
 * fixed twice. `maybeEvict` is the page's, each has its own budgets.
 */
export function vectorProtocolScript(): string {
  return `
    var VECTOR_CACHE = 'veloq-vector-v1';
    var vecHits = 0, vecMisses = 0;
    // The TileJSON is never cached: it names a dated planet snapshot that rolls,
    // and a cached one pins a vintage that goes stale rather than empty, which is
    // harder to diagnose. Its tile template is rewritten back onto the protocol so
    // the tiles it names are the ones the cache serves.
    function vectorTileJson(realUrl) {
      return fetch(realUrl).then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json().then(function(tj) {
          if (tj && tj.tiles) {
            tj.tiles = tj.tiles.map(function(t) {
              return t.indexOf('https://') === 0
                ? 'cached-vector://' + t.substring('https://'.length)
                : t;
            });
          }
          return { data: tj };
        });
      });
    }

    maplibregl.addProtocol('cached-vector', function(params) {
      var realUrl = 'https://' + params.url.substring('cached-vector://'.length);
      if (realUrl.indexOf('.pbf') === -1) return vectorTileJson(realUrl);
      return caches.open(VECTOR_CACHE).then(function(cache) {
        return cache.match(realUrl).then(function(cached) {
          // A zero-length hit is a poisoned entry from the build that asked the
          // origin for the unversioned path. Refetch rather than serve it.
          if (cached) {
            return cached.arrayBuffer().then(function(d) {
              if (d.byteLength > 0) { vecHits++; return { data: d }; }
              return vectorFetch(cache, realUrl);
            });
          }
          return vectorFetch(cache, realUrl);
        });
      });
    });

    // An empty tile is what the origin answers when it is asked for a path it does
    // not serve. It is not an error to MapLibre, so caching it makes a blank map
    // permanent.
    function vectorFetch(cache, realUrl) {
      vecMisses++;
      return fetch(realUrl).then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var copy = r.clone();
        return r.arrayBuffer().then(function(d) {
          if (d.byteLength === 0) throw new Error('empty vector tile: ' + realUrl);
          cache.put(realUrl, copy); maybeEvict(VECTOR_CACHE);
          return { data: d };
        });
      });
    }
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

    // One path for the protocol handler and the zoom prefetch alike. A prefetch
    // that fetches the tile any other way warms the platform HTTP cache, which
    // no budget bounds and no handler reads.
    function terrainTile(realUrl) {
      return caches.open(TERRAIN_CACHE).then(function(cache) {
        return cache.match(realUrl).then(function(cached) {
          if (cached) {
            terrainHits++;
            return cached;
          }
          terrainMisses++;
          return fetch(realUrl).then(function(r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            cache.put(realUrl, r.clone()); maybeEvict(TERRAIN_CACHE);
            return r;
          });
        });
      });
    }

    window._prefetchTerrainTile = function(realUrl) {
      return terrainTile(realUrl).catch(function(err) {
        window._rn_log('terrain prefetch failed: ' + err.message);
      });
    };

    maplibregl.addProtocol('cached-terrain', function(params) {
      var realUrl = 'https://' + params.url.substring('cached-terrain://'.length);
      return terrainTile(realUrl).then(function(r) {
        return r.blob().then(demBlobToImage);
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

${vectorProtocolScript()}

    ${bundledAssetsScript()}

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
 * Registers the `bundled` protocol, which asks the host for a basemap asset that
 * ships in the app and falls back to the network for anything it does not carry.
 *
 * Split out of `tileProtocolsScript` so the snapshot worker can take the bundled
 * assets without also taking the terrain, satellite and vector caches, which
 * would change what a preview costs to render. Pass `workerId` where several
 * pages post through one `onMessage`, so the host knows which to reply into.
 *
 * Expects `demBlobToImage` in scope, which both callers define.
 */
export function bundledAssetsScript(options: { workerId?: string } = {}): string {
  const workerField = options.workerId ? `, workerId: ${options.workerId}` : '';
  return `
    // The sprite and the Latin glyph ranges ship in the app, so a map with no
    // radio still draws its icons and its place names. Anything the host does
    // not carry falls back to the network, which is where CJK lives.
    var BUNDLED_ORIGIN = 'https://tiles.openfreemap.org/';
    window._veloqBlobToImage = demBlobToImage;
    window._bundledRequests = {};
    maplibregl.addProtocol('bundled', function(params) {
      var path = params.url.substring('bundled://'.length);
      var kind = params.type === 'json' ? 'json' : params.type === 'image' ? 'image' : 'arrayBuffer';
      function fromNetwork() {
        return fetch(BUNDLED_ORIGIN + path).then(function(r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          if (kind === 'json') return r.json().then(function(d) { return { data: d }; });
          if (kind === 'image') return r.blob().then(demBlobToImage);
          return r.arrayBuffer().then(function(d) { return { data: d }; });
        });
      }
      if (!window.ReactNativeWebView) return fromNetwork();
      return new Promise(function(resolve) {
        var requestId = '_ba_' + Date.now() + '_' + Math.random().toString(36).substr(2);
        var settled = false;
        function done(value) {
          if (settled) return;
          settled = true;
          delete window._bundledRequests[requestId];
          resolve(value);
        }
        window._bundledRequests[requestId] = { deliver: done, fallback: function() { done(fromNetwork()); }, kind: kind };
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'bundledAssetRequest',
          requestId: requestId,
          path: path${workerField}
        }));
        // A host that never answers must not cost the page its labels.
        setTimeout(function() { if (!settled) done(fromNetwork()); }, 3000);
      });
    });`;
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
