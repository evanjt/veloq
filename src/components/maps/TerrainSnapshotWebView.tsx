/**
 * Hidden WebView pool that renders 3D terrain maps and captures JPEG snapshots.
 *
 * Rendered once in the feed screen, behind content (zIndex: -1, opacity: 0).
 * Two WebView workers process snapshot requests in parallel. Each worker:
 * - Has its own generation counter for race condition protection
 * - Handles one request at a time
 * - Routes messages back via workerId
 *
 * Sky spec is embedded in the style JSON root (not via setSky() API) to ensure
 * it survives setStyle() calls reliably across MapLibre GL JS versions.
 */

import React, { useRef, useCallback, useImperativeHandle, forwardRef, useMemo } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import { WebView } from 'react-native-webview';
import type { MapStyleType } from './mapStyles';
import { getCombinedSatelliteStyle3D, getTerrainSnapshotStyle } from './mapStyles';
import type { TerrainCamera } from '@/lib/utils/cameraAngle';
import { saveTerrainPreview, hasTerrainPreview } from '@/lib/storage/terrainPreviewCache';
import { emitSnapshotComplete } from '@/lib/events/terrainSnapshotEvents';

const SNAPSHOT_TIMEOUT_MS = 20000;
const MAX_QUEUE_SIZE = 30;
const SCREEN_WIDTH = Dimensions.get('window').width;
const SNAPSHOT_HEIGHT = 240;
const POOL_SIZE = 2;

interface SnapshotRequest {
  activityId: string;
  coordinates: [number, number][];
  camera: TerrainCamera;
  mapStyle: MapStyleType;
  routeColor: string;
}

export interface TerrainSnapshotWebViewRef {
  requestSnapshot: (request: SnapshotRequest) => void;
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

    window.map.on('error', function(e) {
      window._rn_log('Map error: ' + (e.error ? e.error.message : JSON.stringify(e)));
    });
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

        // Use minimal terrain-focused styles for light/dark — full vector styles
        // (Liberty, Dark Matter) have dozens of flat layers that clash with 3D terrain
        const styleConfig = isSatellite
          ? JSON.stringify(getCombinedSatelliteStyle3D())
          : JSON.stringify(getTerrainSnapshotStyle(request.mapStyle === 'dark' ? 'dark' : 'light'));

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
              var styleObj = ${styleConfig};
              var activityId = '${request.activityId}';
              var mapStyle = '${request.mapStyle}';
              var myGen = ${gen};

              window._snapshotGen = myGen;

              function isStale() {
                return window._snapshotGen !== myGen;
              }

              window._rn_log('Snapshot ' + activityId + ' gen=' + myGen + ': ' + coords.length + ' coords, style=' + mapStyle);

              // --- Build complete style with all sources and layers ---

              styleObj.sources['terrain'] = {
                type: 'raster-dem',
                tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
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
                    'hillshade-highlight-color': isDark ? '#2A2A2A' : '#FFFBF5',
                    'hillshade-accent-color': isDark ? '#111111' : '#D4C4A8',
                    'hillshade-illumination-anchor': 'map',
                    'hillshade-exaggeration': 0.6,
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
                    paint: { 'line-color': '#FFFFFF', 'line-width': 5, 'line-opacity': 0.7 },
                  },
                  {
                    id: 'route-line',
                    type: 'line',
                    source: 'route',
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: { 'line-color': routeColor, 'line-width': 3 },
                  },
                  {
                    id: 'start-end-border',
                    type: 'circle',
                    source: 'start-end-markers',
                    paint: { 'circle-radius': 5, 'circle-color': '#FFFFFF' },
                  },
                  {
                    id: 'start-end-fill',
                    type: 'circle',
                    source: 'start-end-markers',
                    paint: {
                      'circle-radius': 3.5,
                      'circle-color': ['case', ['==', ['get', 'type'], 'start'], 'rgba(34,197,94,0.85)', 'rgba(239,68,68,0.85)'],
                    },
                  }
                );
              }

              // --- Single atomic setStyle — MapLibre loads everything in parallel ---
              window.map.setStyle(styleObj);
              window.map.jumpTo({
                center: camera.center,
                zoom: camera.zoom,
                bearing: camera.bearing,
                pitch: camera.pitch,
              });

              var done = false;

              window.map.once('idle', function() {
                if (done || isStale()) return;
                if (window.map.areTilesLoaded()) {
                  done = true;
                  window._rn_log('Tiles loaded, capturing...');
                  requestAnimationFrame(function() { setTimeout(captureSnapshot, 50); });
                } else {
                  window._rn_log('First idle but tiles incomplete, waiting...');
                  window.map.once('idle', function() {
                    if (done || isStale()) return;
                    done = true;
                    if (window.map.areTilesLoaded()) {
                      window._rn_log('Tiles loaded on second idle, capturing...');
                      requestAnimationFrame(function() { setTimeout(captureSnapshot, 50); });
                    } else {
                      window._rn_log('Tiles still incomplete after second idle, skipping');
                      window.ReactNativeWebView.postMessage(JSON.stringify({
                        type: 'snapshotError',
                        workerId: workerId,
                        activityId: activityId,
                        gen: myGen,
                        error: 'Tiles incomplete after idle',
                      }));
                    }
                  });
                  setTimeout(function() {
                    if (!done && !isStale()) {
                      done = true;
                      window._rn_log('Second idle timeout (5s), skipping');
                      window.ReactNativeWebView.postMessage(JSON.stringify({
                        type: 'snapshotError',
                        workerId: workerId,
                        activityId: activityId,
                        gen: myGen,
                        error: 'Tile load timeout',
                      }));
                    }
                  }, 5000);
                }
              });

              // Hard timeout (10s safety net)
              setTimeout(function() {
                if (!done && !isStale()) {
                  done = true;
                  window._rn_log('Hard timeout (10s), skipping');
                  window.ReactNativeWebView.postMessage(JSON.stringify({
                    type: 'snapshotError',
                    workerId: workerId,
                    activityId: activityId,
                    gen: myGen,
                    error: 'Render timeout',
                  }));
                }
              }, 10000);

              function captureSnapshot() {
                if (isStale()) { window._rn_log('gen=' + myGen + ' superseded, aborting'); return; }
                try {
                  var canvas = window.map.getCanvas();
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
                  }));
                } catch(e) {
                  window._rn_log('Capture error: ' + e.message);
                  window.ReactNativeWebView.postMessage(JSON.stringify({
                    type: 'snapshotError',
                    workerId: workerId,
                    activityId: activityId,
                    gen: myGen,
                    error: e.message,
                  }));
                }
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
            processNext();
          }
        }, SNAPSHOT_TIMEOUT_MS);
      }
    }, [workers]);

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

            console.log(
              `[TerrainSnapshot:${data.workerId}] Captured ${data.activityId} (${Math.round(data.base64.length / 1024)}KB base64)`
            );
            const uri = await saveTerrainPreview(data.activityId, style, data.base64);
            console.log(`[TerrainSnapshot:${data.workerId}] Saved ${data.activityId} → ${uri}`);
            emitSnapshotComplete(data.activityId, uri);
            processNext();
          } else if (data.type === 'snapshotError') {
            // Discard stale errors from superseded requests
            if (typeof data.gen === 'number' && data.gen !== worker.generationRef.current) {
              console.warn(
                `[TerrainSnapshot:${data.workerId}] Discarding stale error for ${data.activityId} (gen=${data.gen}, current=${worker.generationRef.current})`
              );
              return;
            }

            console.warn(
              `[TerrainSnapshot:${data.workerId}] Error for ${data.activityId}: ${data.error}`
            );
            if (worker.timeoutRef.current) clearTimeout(worker.timeoutRef.current);
            worker.processingRef.current = false;
            worker.currentRequestRef.current = null;
            processNext();
          }
        } catch {
          // Ignore parse errors
        }
      },
      [workers, processNext]
    );

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
          processNext();
        },
      }),
      [processNext]
    );

    return (
      <View style={styles.container} pointerEvents="none">
        {workers.map((worker) => (
          <WebView
            key={worker.id}
            ref={worker.webViewRef as React.RefObject<WebView>}
            source={{ html: workerHtmls[worker.id], baseUrl: 'https://veloq.fit/' }}
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
    opacity: 0,
  },
});
