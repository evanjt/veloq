/**
 * Hidden WebView pool that renders 3D terrain maps and captures JPEG snapshots.
 *
 * Rendered once in the feed screen, behind content (zIndex: -1, opacity: 0.01).
 * opacity: 0 throttles rAF on Android WebView; off-screen positioning prevents
 * WebGL compositing. opacity: 0.01 keeps both rAF and GPU rendering active.
 * Two WebView workers process snapshot requests in parallel. Each worker:
 * - Has its own generation counter for race condition protection
 * - Handles one request at a time
 * - Routes messages back via workerId
 *
 * Sky spec is embedded in the style JSON root (not via setSky() API) to ensure
 * it survives setStyle() calls reliably across MapLibre GL JS versions.
 */

import React, {
  useRef,
  useCallback,
  useImperativeHandle,
  useEffect,
  forwardRef,
  useMemo,
} from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import { WebView } from 'react-native-webview';
import type { MapStyleType } from './mapStyles';
import {
  getSnapshotSatelliteStyle,
  getTerrainSnapshotStyle,
  rewriteSatelliteUrls,
  rewriteVectorUrls,
} from './mapStyles';
import type { TerrainCamera } from '@/lib/utils/cameraAngle';
import { saveTerrainPreview, hasTerrainPreview } from '@/lib/storage/terrainPreviewCache';
import {
  emitSnapshotComplete,
  onClearTileCache,
  onTileCacheStatsRequest,
  emitTileCacheStats,
  onPrefetchTilesRequest,
  type PrefetchTilesBatch,
} from '@/lib/events/terrainSnapshotEvents';
import { generatePreloadScript } from '@/lib/maps/tilePreloader';
import { useSyncDateRange } from '@/providers';

const SNAPSHOT_TIMEOUT_MS = 12000;
const MAX_QUEUE_SIZE = 15;
const SCREEN_WIDTH = Dimensions.get('window').width;
const SNAPSHOT_HEIGHT = 240;
const POOL_SIZE = 2;
const MAX_SNAPSHOT_RETRIES = 1;

interface SnapshotRequest {
  activityId: string;
  coordinates: [number, number][];
  camera: TerrainCamera;
  mapStyle: MapStyleType;
  routeColor: string;
  _retryAttempt?: number;
}

export interface TerrainSnapshotWebViewRef {
  requestSnapshot: (request: SnapshotRequest) => void;
  retryFailed: () => void;
  preloadTiles: (script: string) => void;
}

interface WorkerState {
  id: number;
  webViewRef: { current: WebView | null };
  processingRef: { current: boolean };
  mapReadyRef: { current: boolean };
  generationRef: { current: number };
  timeoutRef: { current: ReturnType<typeof setTimeout> | null };
  currentRequestRef: { current: SnapshotRequest | null };
}

/** Generate the HTML for a worker WebView with its ID baked in. */
function generateWorkerHtml(id: number): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <script src="https://unpkg.com/maplibre-gl@5.19.0/dist/maplibre-gl.js"></script>
  <link href="https://unpkg.com/maplibre-gl@5.19.0/dist/maplibre-gl.css" rel="stylesheet" />
  <style>
    body { margin: 0; padding: 0; overflow: hidden; }
    #map { width: 100vw; height: ${SNAPSHOT_HEIGHT}px; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    // Worker identity — used to route messages back to the correct handler
    window._workerId = ${id};

    // Bridge console to React Native
    window._rn_log = function(msg) {
      try {
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'console',
            workerId: window._workerId,
            message: String(msg)
          }));
        }
      } catch(e) {}
    };

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
    maplibregl.addProtocol('cached-terrain', function(params) {
      var realUrl = 'https://' + params.url.substring('cached-terrain://'.length);
      return caches.open(TERRAIN_CACHE).then(function(cache) {
        return cache.match(realUrl).then(function(cached) {
          if (cached) {
            window._rn_log('DEM cache hit');
            return cached.blob().then(demBlobToImage);
          }
          return fetch(realUrl).then(function(r) {
            window._rn_log('DEM fetch ' + r.status + ': ' + realUrl.split('/').slice(-3).join('/'));
            if (!r.ok) throw new Error('HTTP ' + r.status);
            cache.put(realUrl, r.clone()); maybeEvict(TERRAIN_CACHE);
            return r.blob().then(demBlobToImage);
          });
        });
      }).catch(function(err) {
        window._rn_log('DEM protocol error: ' + err.message);
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
              return { req: req, size: r ? (parseInt(r.headers.get('content-length') || '0') || 0) : 0 };
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

    window._rn_log('Initializing MapLibre (worker ${id})...');

    window.map = new maplibregl.Map({
      container: 'map',
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: [8.5, 47.3],
      zoom: 10,
      pitch: 60,
      attributionControl: false,
      canvasContextAttributes: {
        preserveDrawingBuffer: true,
        antialias: true,
      },
      anisotropicFilterPitch: 0,
      pixelRatio: window.devicePixelRatio || 2,
    });

    window.map.on('load', function() {
      window._rn_log('Map loaded OK (worker ${id})');
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
      window._rn_log('Map error: ' + msg);
      // Count tile-related errors (HTTP failures, 404s, network errors, source errors)
      if (e.sourceId || (e.error && (e.error.status >= 400 || /tile|source|fetch|network|load/i.test(msg)))) {
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

export const TerrainSnapshotWebView = forwardRef<TerrainSnapshotWebViewRef, object>(
  function TerrainSnapshotWebView(_props, ref) {
    // Lazy-init worker pool — created once, never recreated
    const workersRef = useRef<WorkerState[] | null>(null);
    if (workersRef.current === null) {
      workersRef.current = Array.from({ length: POOL_SIZE }, (_, i) => ({
        id: i,
        webViewRef: { current: null },
        processingRef: { current: false },
        mapReadyRef: { current: false },
        generationRef: { current: 0 },
        timeoutRef: { current: null },
        currentRequestRef: { current: null },
      }));
    }
    const workers = workersRef.current;
    const workerHtmls = useMemo(() => workers.map((w) => generateWorkerHtml(w.id)), [workers]);

    const queueRef = useRef<SnapshotRequest[]>([]);
    const queueTotalRef = useRef(0);
    const queueCompletedRef = useRef(0);
    const failedRequestsRef = useRef<SnapshotRequest[]>([]);

    const updateProgress = useCallback(() => {
      const { setTerrainSnapshotProgress } = useSyncDateRange.getState();
      if (queueTotalRef.current === 0 || queueCompletedRef.current >= queueTotalRef.current) {
        setTerrainSnapshotProgress({ status: 'idle', completed: 0, total: 0 });
        queueTotalRef.current = 0;
        queueCompletedRef.current = 0;
      } else {
        setTerrainSnapshotProgress({
          status: 'rendering',
          completed: queueCompletedRef.current,
          total: queueTotalRef.current,
        });
      }
    }, []);

    const processNext = useCallback(() => {
      for (const worker of workers) {
        if (worker.processingRef.current || !worker.mapReadyRef.current) continue;

        // Drain already-cached items from front of queue before assigning to this worker
        while (
          queueRef.current.length > 0 &&
          hasTerrainPreview(queueRef.current[0].activityId, queueRef.current[0].mapStyle)
        ) {
          queueRef.current.shift();
        }
        if (queueRef.current.length === 0) break;

        const request = queueRef.current.shift()!;
        worker.processingRef.current = true;
        worker.currentRequestRef.current = request;
        worker.generationRef.current++;
        const gen = worker.generationRef.current;
        const workerId = worker.id;

        console.log(
          `[TerrainSnapshot:${workerId}] Processing ${request.activityId} gen=${gen} (style: ${request.mapStyle})`
        );

        const isSatellite = request.mapStyle === 'satellite';
        const isDark = request.mapStyle === 'dark' || request.mapStyle === 'satellite';

        // Satellite and dark: use inline style objects.
        // Light: fetch full Liberty style from URL (same as detail 3D view).
        const isLight = !isSatellite && request.mapStyle !== 'dark';
        const styleConfig = isSatellite
          ? JSON.stringify(
              rewriteSatelliteUrls(
                getSnapshotSatelliteStyle(
                  request.camera.center[1],
                  request.camera.center[0],
                  request.camera.zoom
                )
              )
            )
          : isLight
            ? 'null'
            : JSON.stringify(rewriteVectorUrls(getTerrainSnapshotStyle('dark')));
        const lightStyleUrl = isLight ? 'https://tiles.openfreemap.org/styles/liberty' : '';

        const coordsJSON = JSON.stringify(request.coordinates);
        const cameraJSON = JSON.stringify(request.camera);

        // Inject render command — builds complete style with terrain, route, and markers
        // embedded, then applies atomically via single setStyle() call.
        worker.webViewRef.current?.injectJavaScript(`
          (function() {
            try {
              var workerId = ${workerId};
              var coords = ${coordsJSON};
              var camera = ${cameraJSON};
              var isSatellite = ${isSatellite};
              var isDark = ${isDark};
              var routeColor = '${request.routeColor}';
              var lightStyleUrl = '${lightStyleUrl}';
              var inlineStyle = ${styleConfig};
              var activityId = '${request.activityId}';
              var mapStyle = '${request.mapStyle}';
              var myGen = ${gen};

              window._snapshotGen = myGen;
              window._tileErrorCount = 0;

              function isStale() {
                return window._snapshotGen !== myGen;
              }

              window._rn_log('Snapshot ' + activityId + ' gen=' + myGen + ': ' + coords.length + ' coords, style=' + mapStyle);

              // --- Fast path: same base style, just update route + camera ---
              if (window._currentBaseStyle === mapStyle && coords.length > 0) {
                var routeSrc = window.map.getSource('route');
                var markerSrc = window.map.getSource('start-end-markers');
                if (routeSrc && markerSrc) {
                  var fpStart = coords[0];
                  var fpEnd = coords[coords.length - 1];
                  routeSrc.setData({
                    type: 'Feature', properties: {},
                    geometry: { type: 'LineString', coordinates: coords },
                  });
                  markerSrc.setData({
                    type: 'FeatureCollection',
                    features: [
                      { type: 'Feature', properties: { type: 'start' }, geometry: { type: 'Point', coordinates: fpStart } },
                      { type: 'Feature', properties: { type: 'end' }, geometry: { type: 'Point', coordinates: fpEnd } },
                    ],
                  });
                  window.map.setPaintProperty('route-line', 'line-color', routeColor);
                  window.map.jumpTo({
                    center: camera.center, zoom: camera.zoom,
                    bearing: camera.bearing, pitch: camera.pitch,
                  });
                  window._rn_log('Fast path: reusing style, updating route + camera');
                  var done = false;
                  var fpStart = Date.now();
                  var fpLastData = 0;

                  function fpOnData() { fpLastData = Date.now(); }
                  window.map.on('data', fpOnData);

                  // Fast path: idle event — deferred by one frame so MapLibre
                  // processes the camera change and queues tile requests first.
                  // Without this, idle fires immediately (style unchanged, no pending tiles).
                  requestAnimationFrame(function() {
                    window.map.once('idle', function() {
                      if (done || isStale()) return;
                      done = true;
                      window.map.off('data', fpOnData);
                      window._rn_log('Fast path idle, capturing...');
                      requestAnimationFrame(function() { setTimeout(captureSnapshot, 50); });
                    });
                  });

                  // Fast path: poll for tile activity settlement
                  var fpPoll = setInterval(function() {
                    if (done || isStale()) { clearInterval(fpPoll); return; }
                    var now = Date.now();
                    var quietTime = fpLastData > 0 ? now - fpLastData : 0;

                    // Guard: require at least one tile load before accepting styleLoaded.
                    // After jumpTo(), isStyleLoaded() returns true instantly because the
                    // style itself hasn't changed — only the viewport moved.
                    if (fpLastData > 0 && window.map.isStyleLoaded()) {
                      done = true;
                      clearInterval(fpPoll);
                      window.map.off('data', fpOnData);
                      window._rn_log('Fast path styleLoaded, capturing...');
                      requestAnimationFrame(function() { setTimeout(captureSnapshot, 50); });
                      return;
                    }
                    if (fpLastData > 0 && quietTime > 1500) {
                      done = true;
                      clearInterval(fpPoll);
                      window.map.off('data', fpOnData);
                      window._rn_log('Fast path settled (' + quietTime + 'ms quiet), capturing...');
                      requestAnimationFrame(function() { setTimeout(captureSnapshot, 50); });
                      return;
                    }
                    if (now - fpStart > 5000) {
                      done = true;
                      clearInterval(fpPoll);
                      window.map.off('data', fpOnData);
                      window._rn_log('Fast path max wait (5s), capturing...');
                      requestAnimationFrame(function() { setTimeout(captureSnapshot, 50); });
                      return;
                    }
                  }, 500);

                  setTimeout(function() {
                    clearInterval(fpPoll);
                    window.map.off('data', fpOnData);
                    if (!done && !isStale()) {
                      done = true;
                      window._rn_log('Fast path timeout (8s)');
                      window.ReactNativeWebView.postMessage(JSON.stringify({
                        type: 'snapshotError', workerId: workerId, activityId: activityId,
                        gen: myGen, error: 'Fast path render timeout',
                        tileErrors: window._tileErrorCount,
                      }));
                    }
                  }, 8000);
                  return;
                }
              }

              // --- Build complete style with all sources and layers ---
              function applyStyle(styleObj) {

              styleObj.sources['terrain'] = {
                type: 'raster-dem',
                tiles: ['cached-terrain://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
                encoding: 'terrarium',
                tileSize: 256,
                maxzoom: 15,
              };

              styleObj.terrain = { source: 'terrain', exaggeration: 1.5 };

              styleObj.sky = isSatellite
                ? { 'sky-color': '#1a3a5c', 'horizon-color': '#2a4a6c', 'fog-color': '#1a3050',
                    'fog-ground-blend': 0.5, 'horizon-fog-blend': 0.8, 'sky-horizon-blend': 0.5, 'atmosphere-blend': 0.8 }
                : isDark
                ? { 'sky-color': '#0a0a14', 'horizon-color': '#151520', 'fog-color': '#0a0a14',
                    'fog-ground-blend': 0.5, 'horizon-fog-blend': 0.8, 'sky-horizon-blend': 0.5, 'atmosphere-blend': 0.8 }
                : { 'sky-color': '#88C6FC', 'horizon-color': '#B0C8DC', 'fog-color': '#D8E4EE',
                    'fog-ground-blend': 0.5, 'horizon-fog-blend': 0.8, 'sky-horizon-blend': 0.5, 'atmosphere-blend': 0.8 };

              if (!isSatellite) {
                styleObj.layers.push({
                  id: 'hillshading',
                  type: 'hillshade',
                  source: 'terrain',
                  layout: { visibility: 'visible' },
                  paint: {
                    'hillshade-shadow-color': isDark ? '#000000' : '#473B24',
                    'hillshade-illumination-anchor': 'map',
                    'hillshade-exaggeration': 0.3,
                  },
                });
              }

              if (coords.length > 0) {
                var startPt = coords[0];
                var endPt = coords[coords.length - 1];

                styleObj.sources['route'] = {
                  type: 'geojson',
                  data: {
                    type: 'Feature',
                    properties: {},
                    geometry: { type: 'LineString', coordinates: coords },
                  },
                  tolerance: 0,
                };

                styleObj.sources['start-end-markers'] = {
                  type: 'geojson',
                  data: {
                    type: 'FeatureCollection',
                    features: [
                      { type: 'Feature', properties: { type: 'start' }, geometry: { type: 'Point', coordinates: startPt } },
                      { type: 'Feature', properties: { type: 'end' }, geometry: { type: 'Point', coordinates: endPt } },
                    ],
                  },
                };

                styleObj.layers.push(
                  {
                    id: 'route-outline',
                    type: 'line',
                    source: 'route',
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: { 'line-color': '#FFFFFF', 'line-width': 8, 'line-opacity': 0.8 },
                  },
                  {
                    id: 'route-line',
                    type: 'line',
                    source: 'route',
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: { 'line-color': routeColor, 'line-width': 5 },
                  },
                  {
                    id: 'start-end-border',
                    type: 'circle',
                    source: 'start-end-markers',
                    paint: { 'circle-radius': 7, 'circle-color': '#FFFFFF' },
                  },
                  {
                    id: 'start-end-fill',
                    type: 'circle',
                    source: 'start-end-markers',
                    paint: {
                      'circle-radius': 5,
                      'circle-color': ['case', ['==', ['get', 'type'], 'start'], 'rgba(34,197,94,0.75)', 'rgba(239,68,68,0.75)'],
                    },
                  }
                );
              }

              // --- Single atomic setStyle — MapLibre loads everything in parallel ---
              window._rn_log('setStyle: ' + styleObj.layers.length + ' layers, '
                + Object.keys(styleObj.sources).length + ' sources'
                + (styleObj.glyphs ? ', glyphs OK' : ', NO glyphs')
                + (styleObj.sprite ? ', sprite OK' : ', NO sprite'));
              window.map.setStyle(styleObj);
              window.map.jumpTo({
                center: camera.center,
                zoom: camera.zoom,
                bearing: camera.bearing,
                pitch: camera.pitch,
              });

              // --- Readiness detection ---
              // Track only 'data' events (tile loaded) for quiet period, not
              // 'dataloading' (tile requested) which can keep firing from retries.
              window._tileStats = {};
              _rafCount = 0;
              var done = false;
              var setStyleTime = Date.now();
              var lastDataEvent = 0;

              function onDataEvent() { lastDataEvent = Date.now(); }
              window.map.on('data', onDataEvent);

              function cleanup() {
                window.map.off('data', onDataEvent);
              }

              // Idle event — deferred by one frame so MapLibre processes
              // setStyle() and queues initial tile requests first.
              requestAnimationFrame(function() {
                window.map.once('idle', function() {
                  if (done || isStale()) return;
                  done = true;
                  cleanup();
                  window._currentBaseStyle = mapStyle;
                  window._rn_log('Idle event fired, capturing...');
                  requestAnimationFrame(function() { setTimeout(captureSnapshot, 50); });
                });
              });

              // Poll for readiness — multiple strategies
              var readyPoll = setInterval(function() {
                if (done || isStale()) { clearInterval(readyPoll); return; }
                var now = Date.now();
                var elapsed = now - setStyleTime;
                var quietTime = lastDataEvent > 0 ? now - lastDataEvent : 0;

                // Log progress every ~2s (every 4th poll at 500ms)
                if (Math.floor(elapsed / 500) % 4 === 0) {
                  var summary = Object.keys(window._tileStats).map(function(src) {
                    var s = window._tileStats[src];
                    return src + ':' + s.loaded + '/' + s.total;
                  }).join(' | ');
                  window._rn_log('Progress: elapsed=' + elapsed + 'ms quiet=' + quietTime
                    + 'ms rAF/2s=' + _rafCount + ' sources=[' + summary + ']'
                    + ' errors=' + window._tileErrorCount);
                  _rafCount = 0;
                }

                // Strategy 1: MapLibre API says ready (require tile activity first)
                if (lastDataEvent > 0 && window.map.isStyleLoaded()) {
                  done = true;
                  clearInterval(readyPoll);
                  cleanup();
                  window._currentBaseStyle = mapStyle;
                  window._rn_log('styleLoaded=true after ' + elapsed + 'ms, capturing...');
                  requestAnimationFrame(function() { setTimeout(captureSnapshot, 50); });
                  return;
                }

                // Strategy 2: Tile activity settled — no data events for 1.5s
                if (lastDataEvent > 0 && quietTime > 1500) {
                  done = true;
                  clearInterval(readyPoll);
                  cleanup();
                  window._currentBaseStyle = mapStyle;
                  window._rn_log('Tile activity settled (' + quietTime + 'ms quiet, ' + elapsed + 'ms total), capturing...');
                  requestAnimationFrame(function() { setTimeout(captureSnapshot, 50); });
                  return;
                }

                // Strategy 3: Max wait — capture after 7s regardless
                if (elapsed > 7000) {
                  done = true;
                  clearInterval(readyPoll);
                  cleanup();
                  window._currentBaseStyle = mapStyle;
                  window._rn_log('Max wait (7s), capturing best-effort...');
                  requestAnimationFrame(function() { setTimeout(captureSnapshot, 50); });
                  return;
                }
              }, 500);

              // Hard timeout (10s safety net — only if capture itself hangs)
              setTimeout(function() {
                clearInterval(readyPoll);
                cleanup();
                if (!done && !isStale()) {
                  done = true;
                  window._rn_log('Hard timeout (10s), skipping');
                  window.ReactNativeWebView.postMessage(JSON.stringify({
                    type: 'snapshotError',
                    workerId: workerId,
                    activityId: activityId,
                    gen: myGen,
                    error: 'Render timeout',
                    tileErrors: window._tileErrorCount,
                  }));
                }
              }, 10000);

              function captureSnapshot() {
                if (isStale()) { window._rn_log('gen=' + myGen + ' superseded, aborting'); return; }
                try {
                  var canvas = window.map.getCanvas();
                  var w = canvas.width;
                  var h = canvas.height;

                  // Sample edge pixels for white-tile detection — regional sources
                  // (e.g. Swisstopo) return opaque white JPEGs outside coverage area
                  var ctx = canvas.getContext('webgl2') || canvas.getContext('webgl');
                  if (ctx) {
                    var pixel = new Uint8Array(4);
                    var whiteCount = 0;
                    var samplePoints = [
                      [w - 2, Math.floor(h * 0.2)], [w - 2, Math.floor(h * 0.4)],
                      [w - 2, Math.floor(h * 0.6)], [w - 2, Math.floor(h * 0.8)],
                      [Math.floor(w * 0.7), h - 2], [Math.floor(w * 0.8), h - 2],
                      [Math.floor(w * 0.6), Math.floor(h * 0.3)], [Math.floor(w * 0.9), Math.floor(h * 0.5)],
                    ];
                    for (var si = 0; si < samplePoints.length; si++) {
                      var sx = samplePoints[si][0];
                      var sy = h - samplePoints[si][1] - 1; // WebGL y is flipped
                      ctx.readPixels(sx, sy, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, pixel);
                      if (pixel[0] >= 252 && pixel[1] >= 252 && pixel[2] >= 252) {
                        whiteCount++;
                      }
                    }
                    if (whiteCount >= 2) {
                      window._rn_log('White tile detected (' + whiteCount + '/8 samples), rejecting');
                      window.ReactNativeWebView.postMessage(JSON.stringify({
                        type: 'snapshotError',
                        workerId: workerId,
                        activityId: activityId,
                        gen: myGen,
                        error: 'White tile detected',
                        tileErrors: window._tileErrorCount,
                      }));
                      return;
                    }

                    // Gap pixel detection — sample 6 interior points in the terrain area
                    var gapCount = 0;
                    var interiorPoints = [
                      [Math.floor(w * 0.3), Math.floor(h * 0.5)],
                      [Math.floor(w * 0.5), Math.floor(h * 0.5)],
                      [Math.floor(w * 0.7), Math.floor(h * 0.5)],
                      [Math.floor(w * 0.3), Math.floor(h * 0.7)],
                      [Math.floor(w * 0.5), Math.floor(h * 0.7)],
                      [Math.floor(w * 0.7), Math.floor(h * 0.7)],
                    ];
                    for (var gi = 0; gi < interiorPoints.length; gi++) {
                      var gx = interiorPoints[gi][0];
                      var gy = h - interiorPoints[gi][1] - 1;
                      ctx.readPixels(gx, gy, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, pixel);
                      var r = pixel[0], g = pixel[1], b = pixel[2];
                      var isGap = false;
                      // Pure black = failed DEM tile
                      if (r === 0 && g === 0 && b === 0) isGap = true;
                      // Satellite: sky color range (#1a3a5c area)
                      else if (isSatellite && r < 40 && g < 70 && b > 70 && b < 120) isGap = true;
                      // Dark style: background #1A1A1A range
                      else if (!isSatellite && isDark && r < 35 && g < 35 && b < 35) isGap = true;
                      // Light style: background #E8E0D8 range
                      else if (!isSatellite && !isDark && r > 220 && g > 210 && b > 200 && r < 245 && g < 235 && b < 225) isGap = true;
                      if (isGap) gapCount++;
                    }
                    if (gapCount >= 3) {
                      window._rn_log('Gap detected (' + gapCount + '/6 interior samples), rejecting');
                      window.ReactNativeWebView.postMessage(JSON.stringify({
                        type: 'snapshotError',
                        workerId: workerId,
                        activityId: activityId,
                        gen: myGen,
                        error: 'Gap detected (' + gapCount + '/6)',
                        tileErrors: window._tileErrorCount,
                      }));
                      return;
                    }

                    // Tile error count gate — catches gaps outside sampled pixel locations
                    if (window._tileErrorCount >= 2) {
                      window._rn_log('Tile errors detected (' + window._tileErrorCount + '), rejecting');
                      window.ReactNativeWebView.postMessage(JSON.stringify({
                        type: 'snapshotError',
                        workerId: workerId,
                        activityId: activityId,
                        gen: myGen,
                        error: 'Tile errors: ' + window._tileErrorCount,
                        tileErrors: window._tileErrorCount,
                      }));
                      return;
                    }
                  }

                  var dataUrl = canvas.toDataURL('image/jpeg', 0.95);
                  var base64 = dataUrl.split(',')[1];
                  window._rn_log('Captured ' + activityId + ' (' + Math.round(base64.length / 1024) + 'KB)');
                  window.ReactNativeWebView.postMessage(JSON.stringify({
                    type: 'snapshot',
                    workerId: workerId,
                    activityId: activityId,
                    mapStyle: mapStyle,
                    gen: myGen,
                    base64: base64,
                    tileErrors: window._tileErrorCount,
                  }));
                } catch(e) {
                  window._rn_log('Capture error: ' + e.message);
                  window.ReactNativeWebView.postMessage(JSON.stringify({
                    type: 'snapshotError',
                    workerId: workerId,
                    activityId: activityId,
                    gen: myGen,
                    error: e.message,
                    tileErrors: window._tileErrorCount,
                  }));
                }
              } // end captureSnapshot
              } // end applyStyle

              // Light mode: fetch full Liberty style from URL, then apply.
              // Dark/satellite: use the inline style object directly.
              if (lightStyleUrl) {
                window._rn_log('Fetching Liberty style for light mode...');
                fetch(lightStyleUrl)
                  .then(function(r) { return r.json(); })
                  .then(function(fetchedStyle) {
                    if (isStale()) return;
                    // Rewrite OpenMapTiles source to use cached-vector:// protocol
                    // and cap maxzoom at 14 (same as Map3DWebView) to avoid 404s
                    if (fetchedStyle.sources) {
                      var srcKeys = Object.keys(fetchedStyle.sources);
                      for (var si = 0; si < srcKeys.length; si++) {
                        var src = fetchedStyle.sources[srcKeys[si]];
                        if (src.type === 'vector' && src.url === 'https://tiles.openfreemap.org/planet') {
                          delete src.url;
                          src.tiles = ['cached-vector://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf'];
                          src.maxzoom = 14;
                        }
                      }
                    }
                    applyStyle(fetchedStyle);
                  })
                  .catch(function(err) {
                    window._rn_log('Liberty fetch failed: ' + err.message + ', using fallback');
                    applyStyle(inlineStyle || { version: 8, sources: {}, layers: [] });
                  });
              } else {
                applyStyle(inlineStyle);
              }

            } catch(e) {
              window._rn_log('Error: ' + e.message);
              if (window.ReactNativeWebView) {
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: 'snapshotError',
                  workerId: ${workerId},
                  activityId: '${request.activityId}',
                  gen: ${gen},
                  error: e.message,
                }));
              }
            }
          })();
          true;
        `);

        // Per-worker timeout fallback
        worker.timeoutRef.current = setTimeout(() => {
          if (worker.processingRef.current) {
            console.warn(
              `[TerrainSnapshot:${workerId}] Timeout for ${request.activityId} gen=${gen} (${SNAPSHOT_TIMEOUT_MS}ms)`
            );
            worker.processingRef.current = false;
            worker.currentRequestRef.current = null;
            queueCompletedRef.current++;
            updateProgress();
            processNext();
          }
        }, SNAPSHOT_TIMEOUT_MS);
      }
    }, [workers, updateProgress]);

    const handleMessage = useCallback(
      async (event: { nativeEvent: { data: string } }) => {
        try {
          const data = JSON.parse(event.nativeEvent.data);
          if (typeof data !== 'object' || data === null || typeof data.type !== 'string') return;
          if (typeof data.workerId !== 'number') return;

          const worker = workers[data.workerId];
          if (!worker) return;

          if (data.type === 'console') {
            console.log(`[TerrainSnapshot:JS:${data.workerId}] ${data.message}`);
          } else if (data.type === 'mapReady') {
            console.log(`[TerrainSnapshot:${data.workerId}] WebView map ready`);
            worker.mapReadyRef.current = true;
            processNext();
          } else if (data.type === 'snapshot' && data.activityId && data.base64) {
            // Discard stale snapshots from superseded requests
            if (typeof data.gen === 'number' && data.gen !== worker.generationRef.current) {
              console.warn(
                `[TerrainSnapshot:${data.workerId}] Discarding stale snapshot for ${data.activityId} (gen=${data.gen}, current=${worker.generationRef.current})`
              );
              return;
            }

            if (worker.timeoutRef.current) clearTimeout(worker.timeoutRef.current);
            const style =
              (data.mapStyle as MapStyleType) ??
              worker.currentRequestRef.current?.mapStyle ??
              'light';
            worker.processingRef.current = false;
            worker.currentRequestRef.current = null;
            queueCompletedRef.current++;
            updateProgress();
            processNext(); // Start next render immediately

            console.log(
              `[TerrainSnapshot:${data.workerId}] Captured ${data.activityId} (${Math.round(data.base64.length / 1024)}KB base64${data.tileErrors ? `, ${data.tileErrors} tile errors` : ''})`
            );
            // Save concurrently — card shows loading state until emitSnapshotComplete
            try {
              const uri = await saveTerrainPreview(data.activityId, style, data.base64);
              console.log(`[TerrainSnapshot:${data.workerId}] Saved ${data.activityId} → ${uri}`);
              emitSnapshotComplete(data.activityId, uri);
            } catch (saveErr) {
              console.warn(
                `[TerrainSnapshot:${data.workerId}] Save failed for ${data.activityId}:`,
                saveErr
              );
            }
          } else if (data.type === 'tileCacheStats') {
            emitTileCacheStats({
              tileCount: data.tileCount ?? 0,
              totalBytes: data.totalBytes ?? 0,
              terrain: data.terrain ?? undefined,
              satellite: data.satellite ?? undefined,
              vector: data.vector ?? undefined,
            });
          } else if (data.type === 'snapshotError') {
            // Discard stale errors from superseded requests
            if (typeof data.gen === 'number' && data.gen !== worker.generationRef.current) {
              console.warn(
                `[TerrainSnapshot:${data.workerId}] Discarding stale error for ${data.activityId} (gen=${data.gen}, current=${worker.generationRef.current})`
              );
              return;
            }

            if (worker.timeoutRef.current) clearTimeout(worker.timeoutRef.current);
            worker.processingRef.current = false;

            const currentRequest = worker.currentRequestRef.current;
            worker.currentRequestRef.current = null;
            const attempt = currentRequest?._retryAttempt ?? 0;

            if (currentRequest && attempt < MAX_SNAPSHOT_RETRIES) {
              // Retry: push back to front of queue with incremented attempt
              console.warn(
                `[TerrainSnapshot:${data.workerId}] Scheduling retry for ${data.activityId} (attempt ${attempt + 1}, error: ${data.error}, tile errors: ${data.tileErrors ?? 0})`
              );
              queueRef.current.unshift({
                ...currentRequest,
                _retryAttempt: attempt + 1,
              });
              // Short delay before retry to let tile servers recover
              setTimeout(() => processNext(), 200);
            } else {
              // Exhausted retries — save for later re-attempt
              console.warn(
                `[TerrainSnapshot:${data.workerId}] Giving up on ${data.activityId} (error: ${data.error}, tile errors: ${data.tileErrors ?? 0})`
              );
              if (currentRequest) {
                failedRequestsRef.current.push({
                  ...currentRequest,
                  _retryAttempt: 0,
                });
              }
              queueCompletedRef.current++;
              updateProgress();
              processNext();
            }
          }
        } catch {
          // Ignore parse errors
        }
      },
      [workers, processNext, updateProgress]
    );

    // Listen for tile cache clear events from settings
    useEffect(() => {
      return onClearTileCache(() => {
        for (const worker of workers) {
          worker.webViewRef.current?.injectJavaScript(`
          Promise.all([
            caches.delete('veloq-terrain-dem-v1'),
            caches.delete('veloq-satellite-v1'),
            caches.delete('veloq-vector-v1'),
          ]).then(function() {
            window._rn_log('All tile caches cleared');
            window._currentBaseStyle = null;
          });
          true;
        `);
        }
      });
    }, [workers]);

    // Listen for tile cache stats requests from settings
    useEffect(() => {
      return onTileCacheStatsRequest(() => {
        // Query worker 0 if its map is ready
        const worker = workers[0];
        if (!worker?.mapReadyRef.current || !worker.webViewRef.current) return;
        worker.webViewRef.current.injectJavaScript(`
          (function() {
            var cacheNames = ['veloq-terrain-dem-v1', 'veloq-satellite-v1', 'veloq-vector-v1'];
            Promise.all(cacheNames.map(function(name) {
              return caches.open(name).then(function(cache) {
                return cache.keys().then(function(requests) {
                  return Promise.all(requests.map(function(req) {
                    return cache.match(req).then(function(r) {
                      return r ? (parseInt(r.headers.get('content-length') || '0') || 0) : 0;
                    });
                  })).then(function(sizes) {
                    var total = 0;
                    for (var i = 0; i < sizes.length; i++) total += sizes[i];
                    return { name: name, tileCount: requests.length, totalBytes: total };
                  });
                });
              }).catch(function() { return { name: name, tileCount: 0, totalBytes: 0 }; });
            })).then(function(results) {
              var combined = { tileCount: 0, totalBytes: 0, terrain: null, satellite: null, vector: null };
              results.forEach(function(r) {
                combined.tileCount += r.tileCount;
                combined.totalBytes += r.totalBytes;
                if (r.name.indexOf('terrain') >= 0) combined.terrain = { tileCount: r.tileCount, totalBytes: r.totalBytes };
                else if (r.name.indexOf('satellite') >= 0) combined.satellite = { tileCount: r.tileCount, totalBytes: r.totalBytes };
                else if (r.name.indexOf('vector') >= 0) combined.vector = { tileCount: r.tileCount, totalBytes: r.totalBytes };
              });
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'tileCacheStats', workerId: window._workerId,
                tileCount: combined.tileCount, totalBytes: combined.totalBytes,
                terrain: combined.terrain, satellite: combined.satellite, vector: combined.vector,
              }));
            });
          })();
          true;
        `);
      });
    }, [workers]);

    // Listen for prefetch tile requests from TileCacheService
    useEffect(() => {
      return onPrefetchTilesRequest((batches: PrefetchTilesBatch[]) => {
        // Find an idle worker to run the prefetch
        const worker = workers.find((w) => w.mapReadyRef.current && !w.processingRef.current);
        if (!worker?.webViewRef.current) return;

        for (const batch of batches) {
          const script = generatePreloadScript(batch.urls, batch.cacheName);
          worker.webViewRef.current.injectJavaScript(script);
        }
      });
    }, [workers]);

    useImperativeHandle(
      ref,
      () => ({
        requestSnapshot: (request: SnapshotRequest) => {
          // Deduplicate: skip if already cached for this style, or already queued
          if (hasTerrainPreview(request.activityId, request.mapStyle)) return;
          if (
            queueRef.current.some(
              (r) => r.activityId === request.activityId && r.mapStyle === request.mapStyle
            )
          )
            return;

          // Drop oldest if queue is full
          if (queueRef.current.length >= MAX_QUEUE_SIZE) {
            queueRef.current.shift();
          }
          queueRef.current.push(request);
          queueTotalRef.current++;
          updateProgress();
          processNext();
        },
        retryFailed: () => {
          const failed = failedRequestsRef.current;
          if (failed.length === 0) return;
          console.log(`[TerrainSnapshot] Retrying ${failed.length} failed snapshots`);
          failedRequestsRef.current = [];
          for (const req of failed) {
            if (hasTerrainPreview(req.activityId, req.mapStyle)) continue;
            queueRef.current.push(req);
            queueTotalRef.current++;
          }
          updateProgress();
          processNext();
        },
        preloadTiles: (script: string) => {
          // Find an idle worker to run the preload script
          const worker = workers.find((w) => w.mapReadyRef.current && !w.processingRef.current);
          if (worker?.webViewRef.current) {
            worker.webViewRef.current.injectJavaScript(script);
          }
        },
      }),
      [processNext, updateProgress]
    );

    return (
      <View style={styles.container} pointerEvents="none">
        {workers.map((worker) => (
          <WebView
            key={worker.id}
            ref={worker.webViewRef as React.RefObject<WebView>}
            source={{
              html: workerHtmls[worker.id],
              baseUrl: 'https://veloq.fit/',
            }}
            style={StyleSheet.absoluteFillObject}
            scrollEnabled={false}
            bounces={false}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            startInLoadingState={false}
            originWhitelist={['*']}
            mixedContentMode="always"
            androidLayerType="hardware"
            onMessage={handleMessage}
          />
        ))}
      </View>
    );
  }
);

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: SCREEN_WIDTH,
    height: SNAPSHOT_HEIGHT,
    zIndex: -1,
    opacity: 0.01,
  },
});
