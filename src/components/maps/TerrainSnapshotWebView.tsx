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
 * Terrain, hillshade, sky, and route layers are added via the map API after
 * the base style loads — mirrors Map3DWebView so the first terrain drape
 * render already includes the route polyline.
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
import { getSnapshotSatelliteStyle, rewriteSatelliteUrls, TERRAIN_3D_CONFIG } from './mapStyles';
import { DARK_MATTER_STYLE } from './darkMatterStyle';
import type { TerrainCamera } from '@/lib/utils/cameraAngle';
import { saveTerrainPreview, hasTerrainPreview } from '@/lib/storage/terrainPreviewCache';
import {
  emitSnapshotComplete,
  onClearTileCache,
  onTileCacheStatsRequest,
  emitTileCacheStats,
  onPrefetchTilesRequest,
  onCancelWebViewPrefetch,
  emitPrefetchTilesProgress,
  type PrefetchTilesBatch,
} from '@/lib/events/terrainSnapshotEvents';
import { generatePreloadScript } from '@/lib/maps/tilePreloader';
import { buildSnapshotWorkerHtml } from '@/lib/maps/htmlBuilders';
import { useWebViewBridge } from '@/hooks/maps/useWebViewBridge';
import type { WebViewBridgeHandlers, WebViewBridgeMessage } from '@/hooks/maps/useWebViewBridge';
import { useSyncDateRange } from '@/providers';

const SNAPSHOT_TIMEOUT_MS = 8000;
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
    const workerHtmls = useMemo(() => workers.map((w) => buildSnapshotWorkerHtml(w.id)), [workers]);

    const queueRef = useRef<SnapshotRequest[]>([]);
    const queueTotalRef = useRef(0);
    const queueCompletedRef = useRef(0);
    const failedRequestsRef = useRef<SnapshotRequest[]>([]);
    const pendingPrefetchRef = useRef<PrefetchTilesBatch[]>([]);

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
        if (queueRef.current.length === 0) {
          // No more snapshots — drain any queued prefetch batches on this idle worker
          if (pendingPrefetchRef.current.length > 0 && worker.webViewRef.current) {
            worker.webViewRef.current.injectJavaScript('window._prefetchAborted = false; true;');
            const batches = pendingPrefetchRef.current.splice(0);
            for (const batch of batches) {
              worker.webViewRef.current.injectJavaScript(
                generatePreloadScript(batch.urls, batch.cacheName, batch.config)
              );
            }
          }
          break;
        }

        const request = queueRef.current.shift()!;
        worker.processingRef.current = true;
        worker.currentRequestRef.current = request;
        worker.generationRef.current++;
        const gen = worker.generationRef.current;
        const workerId = worker.id;

        if (__DEV__) {
          console.log(
            `[TerrainSnapshot:${workerId}] Processing ${request.activityId} gen=${gen} (style: ${request.mapStyle})`
          );
        }

        const isSatellite = request.mapStyle === 'satellite';
        const isDark = request.mapStyle === 'dark' || request.mapStyle === 'satellite';

        // Satellite and dark: use inline style objects.
        // Light: fetch full Liberty style from URL (same as detail 3D view).
        const isLight = !isSatellite && request.mapStyle !== 'dark';
        // Satellite: rewrite to cached protocol for tile caching.
        // Dark: keep original TileJSON URL — let MapLibre fetch tiles natively
        // (cached-vector:// rewrite was causing blank features after setStyle).
        // Light: fetch URL-based style in JS.
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
            : JSON.stringify(DARK_MATTER_STYLE);
        const lightStyleUrl = isLight ? 'https://tiles.openfreemap.org/styles/liberty' : '';

        const coordsJSON = JSON.stringify(request.coordinates);
        const cameraJSON = JSON.stringify(request.camera);

        // Serialize shared terrain config values for injection into WebView JS
        const terrainSourceJSON = JSON.stringify(TERRAIN_3D_CONFIG.source);
        const skyConfigJSON = JSON.stringify(
          isSatellite
            ? TERRAIN_3D_CONFIG.sky.satellite
            : isDark
              ? TERRAIN_3D_CONFIG.sky.dark
              : TERRAIN_3D_CONFIG.sky.light
        );
        const hillshadePaintJSON = JSON.stringify(
          isDark ? TERRAIN_3D_CONFIG.hillshadePaint.dark : TERRAIN_3D_CONFIG.hillshadePaint.light
        );

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
              var terrainSource = ${terrainSourceJSON};
              var skyConfig = ${skyConfigJSON};
              var hillshadePaint = ${hillshadePaintJSON};
              var hillshadeInsertCandidates = ${JSON.stringify(TERRAIN_3D_CONFIG.hillshadeInsertBeforeCandidates)};

              window._snapshotGen = myGen;
              window._tileErrorCount = 0;

              function isStale() {
                return window._snapshotGen !== myGen;
              }

              window._rn_log('Snapshot ' + activityId + ' gen=' + myGen + ': ' + coords.length + ' coords, style=' + mapStyle);

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
                      // Dark style: only catch failed DEM tiles (near pure black)
                      else if (!isSatellite && isDark && r < 5 && g < 5 && b < 5) isGap = true;
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
              }

              // --- Helper: add route sources + layers via map API ---
              // At IIFE scope so both fast path and full path can use it.
              var hasRoute = coords.length > 0;

              function addRouteLayers() {
                if (!hasRoute) return;
                var startPt = coords[0];
                var endPt = coords[coords.length - 1];
                try { window.map.removeLayer('start-end-fill'); } catch(e) {}
                try { window.map.removeLayer('start-end-border'); } catch(e) {}
                try { window.map.removeLayer('route-line'); } catch(e) {}
                try { window.map.removeLayer('route-outline'); } catch(e) {}
                try { window.map.removeSource('start-end-markers'); } catch(e) {}
                try { window.map.removeSource('route'); } catch(e) {}
                window.map.addSource('route', {
                  type: 'geojson',
                  data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } },
                  tolerance: 0,
                });
                window.map.addSource('start-end-markers', {
                  type: 'geojson',
                  data: {
                    type: 'FeatureCollection',
                    features: [
                      { type: 'Feature', properties: { type: 'start' }, geometry: { type: 'Point', coordinates: startPt } },
                      { type: 'Feature', properties: { type: 'end' }, geometry: { type: 'Point', coordinates: endPt } },
                    ],
                  },
                });
                window.map.addLayer({
                  id: 'route-outline', type: 'line', source: 'route',
                  layout: { 'line-join': 'round', 'line-cap': 'round' },
                  paint: { 'line-color': '#FFFFFF', 'line-width': 5, 'line-opacity': 0.8 },
                });
                window.map.addLayer({
                  id: 'route-line', type: 'line', source: 'route',
                  layout: { 'line-join': 'round', 'line-cap': 'round' },
                  paint: { 'line-color': routeColor, 'line-width': 3 },
                });
                window.map.addLayer({
                  id: 'start-end-border', type: 'circle', source: 'start-end-markers',
                  paint: { 'circle-radius': 7, 'circle-color': '#FFFFFF' },
                });
                window.map.addLayer({
                  id: 'start-end-fill', type: 'circle', source: 'start-end-markers',
                  paint: {
                    'circle-radius': 5,
                    'circle-color': ['case', ['==', ['get', 'type'], 'start'], 'rgba(34,197,94,0.75)', 'rgba(239,68,68,0.75)'],
                  },
                });
                window._rn_log('Route layers added via API');
              }

              // --- Helper: add terrain + hillshade (no route yet) ---
              // Route is added AFTER terrain is fully rendered (separate idle cycle)
              // so the drape texture re-render includes the route.
              function addTerrain() {
                window.map.addSource('terrain', terrainSource);
                window.map.setTerrain({ source: 'terrain', exaggeration: ${TERRAIN_3D_CONFIG.defaultExaggeration} });
                try { window.map.setSky(skyConfig); } catch(e) {}
                if (!isSatellite) {
                  var beforeId = null;
                  for (var ci = 0; ci < hillshadeInsertCandidates.length; ci++) {
                    if (window.map.getLayer(hillshadeInsertCandidates[ci])) {
                      beforeId = hillshadeInsertCandidates[ci];
                      break;
                    }
                  }
                  window.map.addLayer({
                    id: 'hillshading', type: 'hillshade', source: 'terrain',
                    layout: { visibility: 'visible' },
                    paint: hillshadePaint,
                  }, beforeId);
                }
                window._rn_log('Terrain + hillshade added via API');
              }

              // --- Fast path: same base style, just update camera + route ---
              if (window._currentBaseStyle === mapStyle && coords.length > 0) {
                if (window.map.getSource('terrain')) {
                  window.map.jumpTo({
                    center: camera.center, zoom: camera.zoom,
                    bearing: camera.bearing, pitch: camera.pitch,
                  });
                  window._rn_log('Fast path: jumped camera, waiting for terrain...');
                  var done = false;
                  var fpStart = Date.now();
                  var fpLastData = 0;

                  function fpOnData() { fpLastData = Date.now(); }
                  window.map.on('data', fpOnData);

                  // Helper: add route layers after terrain settles, then capture
                  function fpAddRouteAndCapture(reason) {
                    window._rn_log(reason);
                    addRouteLayers();
                    window.map.once('idle', function() {
                      window._rn_log('Fast path route idle, capturing...');
                      requestAnimationFrame(function() { setTimeout(captureSnapshot, 50); });
                    });
                  }

                  // Fast path: idle event — deferred by one frame so MapLibre
                  // processes the camera change and queues tile requests first.
                  requestAnimationFrame(function() {
                    window.map.once('idle', function() {
                      if (done || isStale()) return;
                      done = true;
                      window.map.off('data', fpOnData);
                      fpAddRouteAndCapture('Fast path idle, adding route...');
                    });
                  });

                  // Fast path: poll for tile activity settlement
                  var fpPoll = setInterval(function() {
                    if (done || isStale()) { clearInterval(fpPoll); return; }
                    var now = Date.now();
                    var quietTime = fpLastData > 0 ? now - fpLastData : 0;

                    if (fpLastData > 0 && window.map.isStyleLoaded()) {
                      done = true;
                      clearInterval(fpPoll);
                      window.map.off('data', fpOnData);
                      fpAddRouteAndCapture('Fast path styleLoaded');
                      return;
                    }
                    if (fpLastData > 0 && quietTime > 1500) {
                      done = true;
                      clearInterval(fpPoll);
                      window.map.off('data', fpOnData);
                      fpAddRouteAndCapture('Fast path settled (' + quietTime + 'ms quiet)');
                      return;
                    }
                    if (now - fpStart > 5000) {
                      done = true;
                      clearInterval(fpPoll);
                      window.map.off('data', fpOnData);
                      fpAddRouteAndCapture('Fast path max wait (5s)');
                      return;
                    }
                  }, 500);

                  setTimeout(function() {
                    clearInterval(fpPoll);
                    window.map.off('data', fpOnData);
                    if (!done && !isStale()) {
                      done = true;
                      window._rn_log('Fast path timeout (6s)');
                      window.ReactNativeWebView.postMessage(JSON.stringify({
                        type: 'snapshotError', workerId: workerId, activityId: activityId,
                        gen: myGen, error: 'Fast path render timeout',
                        tileErrors: window._tileErrorCount,
                      }));
                    }
                  }, 6000);
                  return;
                }
              }

              // --- Full path: everything in style JSON (atomic) ---
              function applyStyle(styleObj) {

              // Embed terrain, hillshade, and route directly in the style JSON
              // so the drape texture includes the route from the very first render.
              styleObj.sources['terrain'] = terrainSource;
              styleObj.terrain = { source: 'terrain', exaggeration: ${TERRAIN_3D_CONFIG.defaultExaggeration} };
              styleObj.sky = skyConfig;

              // Insert hillshade before the first transportation/building layer
              if (!isSatellite) {
                var candidateSet = {};
                for (var ci = 0; ci < hillshadeInsertCandidates.length; ci++) {
                  candidateSet[hillshadeInsertCandidates[ci]] = true;
                }
                var hillshadeIdx = styleObj.layers.length;
                for (var li = 0; li < styleObj.layers.length; li++) {
                  if (candidateSet[styleObj.layers[li].id]) {
                    hillshadeIdx = li;
                    break;
                  }
                }
                styleObj.layers.splice(hillshadeIdx, 0, {
                  id: 'hillshading',
                  type: 'hillshade',
                  source: 'terrain',
                  layout: { visibility: 'visible' },
                  paint: hillshadePaint,
                });
              }

              // Add route source + layers at the end of the style
              if (hasRoute) {
                var startPt = coords[0];
                var endPt = coords[coords.length - 1];

                styleObj.sources['route'] = {
                  type: 'geojson',
                  data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } },
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

                styleObj.layers.push({
                  id: 'route-outline', type: 'line', source: 'route',
                  layout: { 'line-join': 'round', 'line-cap': 'round' },
                  paint: { 'line-color': '#FFFFFF', 'line-width': 5, 'line-opacity': 0.8 },
                });
                styleObj.layers.push({
                  id: 'route-line', type: 'line', source: 'route',
                  layout: { 'line-join': 'round', 'line-cap': 'round' },
                  paint: { 'line-color': routeColor, 'line-width': 3 },
                });
                styleObj.layers.push({
                  id: 'start-end-border', type: 'circle', source: 'start-end-markers',
                  paint: { 'circle-radius': 7, 'circle-color': '#FFFFFF' },
                });
                styleObj.layers.push({
                  id: 'start-end-fill', type: 'circle', source: 'start-end-markers',
                  paint: {
                    'circle-radius': 5,
                    'circle-color': ['case', ['==', ['get', 'type'], 'start'], 'rgba(34,197,94,0.75)', 'rgba(239,68,68,0.75)'],
                  },
                });
              }

              window._rn_log('setStyle (all-in-one): ' + styleObj.layers.length + ' layers, '
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

              // Wait for everything to load (DEM + vector + route tiles)
              window._tileStats = {};
              _rafCount = 0;
              var done = false;
              var setStyleTime = Date.now();

              var readyPoll = setInterval(function() {
                if (done || isStale()) { clearInterval(readyPoll); return; }
                var elapsed = Date.now() - setStyleTime;

                if (window.map.isStyleLoaded() || elapsed > 5000) {
                  done = true;
                  clearInterval(readyPoll);
                  window._currentBaseStyle = mapStyle;
                  window._rn_log('All loaded after ' + elapsed + 'ms, capturing...');
                  requestAnimationFrame(function() { setTimeout(captureSnapshot, 50); });
                  return;
                }
              }, 200);

              // Hard timeout
              setTimeout(function() {
                clearInterval(readyPoll);
                if (!done && !isStale()) {
                  done = true;
                  window._rn_log('Hard timeout (6s), skipping');
                  window.ReactNativeWebView.postMessage(JSON.stringify({
                    type: 'snapshotError',
                    workerId: workerId,
                    activityId: activityId,
                    gen: myGen,
                    error: 'Render timeout',
                    tileErrors: window._tileErrorCount,
                  }));
                }
              }, 6000);

              } // end applyStyle

              // Light mode: fetch full Liberty style from URL, then apply.
              // Don't rewrite vector URLs — let MapLibre handle TileJSON natively.
              // Dark/satellite: use the inline style object directly.
              if (lightStyleUrl) {
                window._rn_log('Fetching Liberty style for light mode...');
                fetch(lightStyleUrl)
                  .then(function(r) { return r.json(); })
                  .then(function(fetchedStyle) {
                    if (isStale()) return;
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
            if (__DEV__) {
              console.warn(
                `[TerrainSnapshot:${workerId}] Timeout for ${request.activityId} gen=${gen} (${SNAPSHOT_TIMEOUT_MS}ms)`
              );
            }
            worker.processingRef.current = false;
            worker.currentRequestRef.current = null;
            queueCompletedRef.current++;
            updateProgress();
            processNext();
          }
        }, SNAPSHOT_TIMEOUT_MS);
      }
    }, [workers, updateProgress]);

    // Handle messages from WebView — dispatch via shared bridge.
    // Each handler does its own worker lookup by `data.workerId` because
    // multiple worker WebViews post through the same `onMessage` callback.
    const bridgeHandlers = useMemo<WebViewBridgeHandlers>(
      () => ({
        console: (data: WebViewBridgeMessage) => {
          if (typeof data.workerId !== 'number') return;
          if (!workers[data.workerId]) return;
          if (__DEV__) console.log(`[TerrainSnapshot:JS:${data.workerId}] ${data.message}`);
        },
        mapReady: (data: WebViewBridgeMessage) => {
          if (typeof data.workerId !== 'number') return;
          const worker = workers[data.workerId];
          if (!worker) return;
          if (__DEV__) console.log(`[TerrainSnapshot:${data.workerId}] WebView map ready`);
          worker.mapReadyRef.current = true;
          processNext();
        },
        snapshot: async (data: WebViewBridgeMessage) => {
          if (typeof data.workerId !== 'number') return;
          const worker = workers[data.workerId];
          if (!worker) return;
          if (!data.activityId || !data.base64) return;

          // Discard stale snapshots from superseded requests
          if (typeof data.gen === 'number' && data.gen !== worker.generationRef.current) {
            if (__DEV__) {
              console.warn(
                `[TerrainSnapshot:${data.workerId}] Discarding stale snapshot for ${data.activityId} (gen=${data.gen}, current=${worker.generationRef.current})`
              );
            }
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

          const base64 = data.base64 as string;
          const activityId = data.activityId as string;
          if (__DEV__) {
            console.log(
              `[TerrainSnapshot:${data.workerId}] Captured ${activityId} (${Math.round(base64.length / 1024)}KB base64${data.tileErrors ? `, ${data.tileErrors} tile errors` : ''})`
            );
          }
          // Save concurrently — card shows loading state until emitSnapshotComplete
          try {
            const uri = await saveTerrainPreview(activityId, style, base64);
            if (__DEV__)
              console.log(`[TerrainSnapshot:${data.workerId}] Saved ${activityId} → ${uri}`);
            emitSnapshotComplete(activityId, uri);
          } catch (saveErr) {
            if (__DEV__) {
              console.warn(
                `[TerrainSnapshot:${data.workerId}] Save failed for ${activityId}:`,
                saveErr
              );
            }
          }
        },
        tileCacheStats: (data: WebViewBridgeMessage) => {
          if (typeof data.workerId !== 'number') return;
          if (!workers[data.workerId]) return;
          emitTileCacheStats({
            tileCount: (data.tileCount as number) ?? 0,
            totalBytes: (data.totalBytes as number) ?? 0,
            terrain: (data.terrain as { tileCount: number; totalBytes: number }) ?? undefined,
            satellite: (data.satellite as { tileCount: number; totalBytes: number }) ?? undefined,
            vector: (data.vector as { tileCount: number; totalBytes: number }) ?? undefined,
          });
        },
        prefetchProgress: (data: WebViewBridgeMessage) => {
          if (typeof data.workerId !== 'number') return;
          if (!workers[data.workerId]) return;
          emitPrefetchTilesProgress((data.completed as number) ?? 0, (data.total as number) ?? 0);
        },
        snapshotError: (data: WebViewBridgeMessage) => {
          if (typeof data.workerId !== 'number') return;
          const worker = workers[data.workerId];
          if (!worker) return;

          // Discard stale errors from superseded requests
          if (typeof data.gen === 'number' && data.gen !== worker.generationRef.current) {
            if (__DEV__) {
              console.warn(
                `[TerrainSnapshot:${data.workerId}] Discarding stale error for ${data.activityId} (gen=${data.gen}, current=${worker.generationRef.current})`
              );
            }
            return;
          }

          if (worker.timeoutRef.current) clearTimeout(worker.timeoutRef.current);
          worker.processingRef.current = false;

          const currentRequest = worker.currentRequestRef.current;
          worker.currentRequestRef.current = null;
          const tileErrors = (data.tileErrors as number) ?? 0;
          const attempt = currentRequest?._retryAttempt ?? 0;

          if (currentRequest && attempt < MAX_SNAPSHOT_RETRIES) {
            // Retry: push back to front of queue with incremented attempt
            if (__DEV__) {
              console.warn(
                `[TerrainSnapshot:${data.workerId}] Scheduling retry for ${data.activityId} (attempt ${attempt + 1}, error: ${data.error}, tile errors: ${tileErrors})`
              );
            }
            queueRef.current.unshift({
              ...currentRequest,
              _retryAttempt: attempt + 1,
            });
            // Delay retry to let tile servers recover
            setTimeout(() => processNext(), 2000);
          } else {
            // Exhausted retries — save for later re-attempt
            if (__DEV__) {
              console.warn(
                `[TerrainSnapshot:${data.workerId}] Giving up on ${data.activityId} (error: ${data.error}, tile errors: ${tileErrors})`
              );
            }
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
        },
      }),
      [workers, processNext, updateProgress]
    );
    const handleMessage = useWebViewBridge(bridgeHandlers);

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
        if (!worker?.webViewRef.current) {
          // All workers busy — queue for later execution when snapshots finish
          pendingPrefetchRef.current.push(...batches);
          return;
        }

        // Reset abort flag before starting new prefetch
        worker.webViewRef.current.injectJavaScript('window._prefetchAborted = false; true;');

        for (const batch of batches) {
          const script = generatePreloadScript(batch.urls, batch.cacheName, batch.config);
          worker.webViewRef.current.injectJavaScript(script);
        }
      });
    }, [workers]);

    // Listen for cancel events — set abort flag in all workers
    useEffect(() => {
      return onCancelWebViewPrefetch(() => {
        for (const worker of workers) {
          if (worker.webViewRef.current && worker.mapReadyRef.current) {
            worker.webViewRef.current.injectJavaScript('window._prefetchAborted = true; true;');
          }
        }
        pendingPrefetchRef.current = [];
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
          if (__DEV__) console.log(`[TerrainSnapshot] Retrying ${failed.length} failed snapshots`);
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
