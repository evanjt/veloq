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
 * it survives setStyle() calls in MapLibre GL JS 3.6.2.
 */

import React, { useRef, useCallback, useImperativeHandle, forwardRef, useMemo } from 'react';
import { View, StyleSheet, Dimensions, PixelRatio } from 'react-native';
import { WebView } from 'react-native-webview';
import type { MapStyleType } from './mapStyles';
import { getCombinedSatelliteStyle3D, getTerrainSnapshotStyle } from './mapStyles';
import type { TerrainCamera } from '@/lib/utils/cameraAngle';
import { saveTerrainPreview, hasTerrainPreview } from '@/lib/storage/terrainPreviewCache';
import { emitSnapshotComplete } from '@/lib/events/terrainSnapshotEvents';

// Use actual device DPR — the canvas must match physical pixels or the JPEG gets
// upscaled when displayed (SCREEN_WIDTH dp × deviceDPR = physical width). Regional
// satellite sources (swisstopo maxzoom:20, IGN maxzoom:20) are unaffected; only the
// EOX global fallback (maxzoom:14) can hit its tile limit at very high camera zoom.
const DEVICE_PIXEL_RATIO = PixelRatio.get();
const SNAPSHOT_TIMEOUT_MS = 20000;
const MAX_QUEUE_SIZE = 30;
const SCREEN_WIDTH = Dimensions.get('window').width;
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
  <script src="https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.js"></script>
  <link href="https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.css" rel="stylesheet" />
  <style>
    body { margin: 0; padding: 0; overflow: hidden; }
    #map { width: 100vw; height: 100vh; }
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
      preserveDrawingBuffer: true,
      antialias: true,
      pixelRatio: ${DEVICE_PIXEL_RATIO},
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

        // Inject render command — embeds sky in style root, adds terrain, waits for tiles,
        // adds route ON TOP of loaded terrain, captures on 'idle'.
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

              // Set generation on window — newer requests will overwrite this
              window._snapshotGen = myGen;

              // Check if this request is still current (not superseded by a newer one)
              function isStale() {
                return window._snapshotGen !== myGen;
              }

              window._rn_log('Snapshot ' + activityId + ' gen=' + myGen + ': ' + coords.length + ' coords, style=' + mapStyle);

              // Remove existing layers/sources
              try {
                if (window.map.getLayer('start-end-fill')) window.map.removeLayer('start-end-fill');
                if (window.map.getLayer('start-end-border')) window.map.removeLayer('start-end-border');
                if (window.map.getSource('start-end-markers')) window.map.removeSource('start-end-markers');
                if (window.map.getLayer('route-line')) window.map.removeLayer('route-line');
                if (window.map.getLayer('route-outline')) window.map.removeLayer('route-outline');
                if (window.map.getSource('route')) window.map.removeSource('route');
                if (window.map.getLayer('hillshading')) window.map.removeLayer('hillshading');
                if (window.map.getSource('terrain')) {
                  window.map.setTerrain(null);
                  window.map.removeSource('terrain');
                }
              } catch(e) {
                window._rn_log('Cleanup error (ok): ' + e.message);
              }

              // Embed sky spec in style root — applied atomically with setStyle().
              // Avoids setSky() API issues in MapLibre GL JS 3.6.2.
              styleObj.sky = isSatellite
                ? { 'sky-color': '#1a3a5c', 'horizon-color': '#2a4a6c', 'fog-color': '#1a3050',
                    'fog-ground-blend': 0.5, 'horizon-fog-blend': 0.8, 'sky-horizon-blend': 0.5, 'atmosphere-blend': 0.8 }
                : isDark
                ? { 'sky-color': '#0a0a14', 'horizon-color': '#151520', 'fog-color': '#0a0a14',
                    'fog-ground-blend': 0.5, 'horizon-fog-blend': 0.8, 'sky-horizon-blend': 0.5, 'atmosphere-blend': 0.8 }
                : { 'sky-color': '#88C6FC', 'horizon-color': '#B0C8DC', 'fog-color': '#D8E4EE',
                    'fog-ground-blend': 0.5, 'horizon-fog-blend': 0.8, 'sky-horizon-blend': 0.5, 'atmosphere-blend': 0.8 };

              // Set new style (sky included atomically)
              window.map.setStyle(styleObj);

              // Poll for style to be loaded
              var styleRetries = 0;
              var maxStyleRetries = 50;

              function waitForStyle() {
                if (isStale()) { window._rn_log('gen=' + myGen + ' superseded in waitForStyle, aborting'); return; }
                styleRetries++;
                if (window.map.isStyleLoaded()) {
                  window._rn_log('Style loaded after ' + styleRetries + ' polls');
                  onStyleReady();
                } else if (styleRetries >= maxStyleRetries) {
                  window._rn_log('Style load timeout after ' + maxStyleRetries + ' polls');
                  window.ReactNativeWebView.postMessage(JSON.stringify({
                    type: 'snapshotError',
                    workerId: workerId,
                    activityId: activityId,
                    gen: myGen,
                    error: 'Style load timeout',
                  }));
                } else {
                  setTimeout(waitForStyle, 200);
                }
              }

              function onStyleReady() {
                if (isStale()) { window._rn_log('gen=' + myGen + ' superseded in onStyleReady, aborting'); return; }
                try {
                  // Add terrain
                  window.map.addSource('terrain', {
                    type: 'raster-dem',
                    tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
                    encoding: 'terrarium',
                    tileSize: 256,
                    maxzoom: 15,
                  });
                  window.map.setTerrain({ source: 'terrain', exaggeration: 1.5 });

                  // Hillshade (non-satellite only) — enhanced for terrain-focused snapshots
                  if (!isSatellite) {
                    window.map.addLayer({
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

                  // Move camera BEFORE loading terrain tiles
                  window.map.jumpTo({
                    center: camera.center,
                    zoom: camera.zoom,
                    bearing: camera.bearing,
                    pitch: camera.pitch,
                  });

                  window._rn_log('Terrain + camera set, waiting for tiles...');

                  // Nudge tile loading by forcing viewport recalculation
                  window.map.resize();

                  // Event-driven tile loading via MapLibre 'idle' event
                  var tileLoadTimedOut = false;
                  var tileLoadDone = false;

                  function onTilesReady() {
                    if (tileLoadDone || isStale()) return;
                    tileLoadDone = true;
                    addRouteAndCapture();
                  }

                  window.map.once('idle', function() {
                    if (isStale()) { window._rn_log('gen=' + myGen + ' superseded in idle, aborting'); return; }
                    if (window.map.isSourceLoaded('terrain') && window.map.areTilesLoaded()) {
                      window._rn_log('Tiles loaded on first idle');
                      onTilesReady();
                    } else {
                      window._rn_log('First idle but tiles incomplete, waiting for second idle...');
                      // One more idle cycle with 5s fallback
                      var secondIdleDone = false;
                      window.map.once('idle', function() {
                        if (secondIdleDone || isStale()) return;
                        secondIdleDone = true;
                        if (window.map.areTilesLoaded()) {
                          window._rn_log('Tiles loaded on second idle');
                          onTilesReady();
                        } else {
                          // Tiles still incomplete — skip this snapshot
                          window._rn_log('Tiles still incomplete after second idle, skipping snapshot');
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
                        if (!secondIdleDone && !isStale()) {
                          secondIdleDone = true;
                          window._rn_log('Second idle fallback (5s), skipping snapshot');
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

                  // Hard fallback timeout (12s safety net)
                  setTimeout(function() {
                    if (!tileLoadDone && !isStale()) {
                      tileLoadTimedOut = true;
                      window._rn_log('Hard fallback timeout (12s), skipping snapshot');
                      window.ReactNativeWebView.postMessage(JSON.stringify({
                        type: 'snapshotError',
                        workerId: workerId,
                        activityId: activityId,
                        gen: myGen,
                        error: 'Hard tile load timeout',
                      }));
                    }
                  }, 12000);

                  // Add route ON TOP of fully-loaded terrain, then capture on idle
                  function addRouteAndCapture() {
                    if (isStale()) { window._rn_log('gen=' + myGen + ' superseded in addRouteAndCapture, aborting'); return; }
                    try {
                      if (coords.length > 0) {
                        window.map.addSource('route', {
                          type: 'geojson',
                          data: {
                            type: 'Feature',
                            properties: {},
                            geometry: { type: 'LineString', coordinates: coords },
                          },
                          tolerance: 0,
                        });
                        window.map.addLayer({
                          id: 'route-outline',
                          type: 'line',
                          source: 'route',
                          layout: { 'line-join': 'round', 'line-cap': 'round' },
                          paint: { 'line-color': '#FFFFFF', 'line-width': 5, 'line-opacity': 0.7 },
                        });
                        window.map.addLayer({
                          id: 'route-line',
                          type: 'line',
                          source: 'route',
                          layout: { 'line-join': 'round', 'line-cap': 'round' },
                          paint: { 'line-color': routeColor, 'line-width': 3 },
                        });

                        // Start/end circle markers
                        var startPt = coords[0];
                        var endPt = coords[coords.length - 1];
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
                          id: 'start-end-border',
                          type: 'circle',
                          source: 'start-end-markers',
                          paint: { 'circle-radius': 5, 'circle-color': '#FFFFFF' },
                        });
                        window.map.addLayer({
                          id: 'start-end-fill',
                          type: 'circle',
                          source: 'start-end-markers',
                          paint: {
                            'circle-radius': 3.5,
                            'circle-color': ['case', ['==', ['get', 'type'], 'start'], 'rgba(34,197,94,0.85)', 'rgba(239,68,68,0.85)'],
                          },
                        });
                        window._rn_log('Route layers + markers added (' + coords.length + ' pts)');
                      } else {
                        window._rn_log('WARNING: No coordinates for route!');
                      }

                      // Use idle event for reliable capture — fires after all rendering is done
                      var idleFired = false;
                      window.map.once('idle', function() {
                        if (idleFired || isStale()) return;
                        idleFired = true;

                        // Final tile check — route rendering may have evicted tiles
                        if (!window.map.areTilesLoaded()) {
                          window._rn_log('Tiles evicted after route add, waiting 500ms...');
                          setTimeout(function() {
                            if (!isStale()) captureSnapshot();
                          }, 500);
                        } else {
                          window._rn_log('Map idle, capturing...');
                          // Extra frame to ensure GPU has painted the route
                          requestAnimationFrame(function() {
                            setTimeout(captureSnapshot, 50);
                          });
                        }
                      });

                      // Fallback if idle never fires (shouldn't happen but safety net)
                      setTimeout(function() {
                        if (!idleFired && !isStale()) {
                          idleFired = true;
                          window._rn_log('Idle timeout fallback, capturing...');
                          captureSnapshot();
                        }
                      }, 3000);

                    } catch(e) {
                      window._rn_log('addRouteAndCapture error: ' + e.message);
                      if (!isStale()) captureSnapshot();
                    }
                  }

                  function captureSnapshot() {
                    if (isStale()) { window._rn_log('gen=' + myGen + ' superseded in captureSnapshot, aborting'); return; }
                    try {
                      var canvas = window.map.getCanvas();
                      var dataUrl = canvas.toDataURL('image/jpeg', 0.92);
                      var base64 = dataUrl.split(',')[1];
                      window._rn_log('Captured ' + activityId + ' gen=' + myGen + ' (' + Math.round(base64.length / 1024) + 'KB)');
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

                  // Idle-based tile loading is already wired up above
                } catch(e) {
                  window._rn_log('onStyleReady error: ' + e.message);
                  window.ReactNativeWebView.postMessage(JSON.stringify({
                    type: 'snapshotError',
                    workerId: workerId,
                    activityId: activityId,
                    gen: myGen,
                    error: e.message,
                  }));
                }
              }

              // Start polling for style (first poll after 100ms)
              setTimeout(waitForStyle, 100);

            } catch(e) {
              window._rn_log('Top-level error: ' + e.message);
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
    height: 240,
    zIndex: -1,
    opacity: 0,
  },
});
