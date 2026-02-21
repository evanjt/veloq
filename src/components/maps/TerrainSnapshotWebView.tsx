/**
 * Hidden WebView that renders 3D terrain maps and captures JPEG snapshots.
 *
 * Rendered once in the feed screen, behind content (zIndex: -1, opacity: 0).
 * Processes a queue of snapshot requests one at a time. Uses polling to detect
 * when MapLibre has finished loading, then captures via `canvas.toDataURL()`.
 *
 * RACE CONDITION GUARD: Each request gets a monotonically increasing generation
 * counter (`window._snapshotGen`). All async JS callbacks check the counter
 * before proceeding — if a newer request has started, the stale callback aborts.
 * This prevents a timed-out request from capturing a newer request's map content.
 */

import React, { useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import { View, StyleSheet, Dimensions, PixelRatio } from 'react-native';
import { WebView } from 'react-native-webview';
import type { MapStyleType } from './mapStyles';
import { getCombinedSatelliteStyle } from './mapStyles';
import { DARK_MATTER_STYLE } from './darkMatterStyle';
import type { TerrainCamera } from '@/lib/utils/cameraAngle';
import { saveTerrainPreview, hasTerrainPreview } from '@/lib/storage/terrainPreviewCache';
import { emitSnapshotComplete } from '@/lib/events/terrainSnapshotEvents';

const DEVICE_PIXEL_RATIO = PixelRatio.get();
const SNAPSHOT_TIMEOUT_MS = 20000;
const MAX_QUEUE_SIZE = 30;
const SCREEN_WIDTH = Dimensions.get('window').width;

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

export const TerrainSnapshotWebView = forwardRef<TerrainSnapshotWebViewRef, object>(
  function TerrainSnapshotWebView(_props, ref) {
    const webViewRef = useRef<WebView>(null);
    const queueRef = useRef<SnapshotRequest[]>([]);
    const processingRef = useRef(false);
    const mapReadyRef = useRef(false);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const currentRequestRef = useRef<SnapshotRequest | null>(null);
    // Generation counter — incremented each request, passed into JS and back in messages
    const generationRef = useRef(0);

    const processNext = useCallback(() => {
      if (processingRef.current || !mapReadyRef.current) return;
      if (queueRef.current.length === 0) return;

      const request = queueRef.current.shift()!;

      // Skip if already cached for this style
      if (hasTerrainPreview(request.activityId, request.mapStyle)) {
        processNext();
        return;
      }

      processingRef.current = true;
      currentRequestRef.current = request;
      generationRef.current++;
      const gen = generationRef.current;
      console.log(
        `[TerrainSnapshot] Processing ${request.activityId} gen=${gen} (style: ${request.mapStyle})`
      );

      const isSatellite = request.mapStyle === 'satellite';
      const isDark = request.mapStyle === 'dark' || request.mapStyle === 'satellite';

      const styleConfig = isSatellite
        ? JSON.stringify(getCombinedSatelliteStyle())
        : request.mapStyle === 'dark'
          ? JSON.stringify(DARK_MATTER_STYLE)
          : `"https://tiles.openfreemap.org/styles/liberty"`;

      const coordsJSON = JSON.stringify(request.coordinates);
      const cameraJSON = JSON.stringify(request.camera);

      // Inject render command — adds terrain first, waits for tiles, then adds
      // route ON TOP of loaded terrain to ensure draping, captures on 'idle'.
      webViewRef.current?.injectJavaScript(`
        (function() {
          try {
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

            // Set new style
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

                // Hillshade (non-satellite only)
                if (!isSatellite) {
                  try {
                    window.map.addLayer({
                      id: 'hillshading',
                      type: 'hillshade',
                      source: 'terrain',
                      layout: { visibility: 'visible' },
                      paint: {
                        'hillshade-shadow-color': isDark ? '#000000' : '#473B24',
                        'hillshade-illumination-anchor': 'map',
                        'hillshade-exaggeration': 0.3,
                      },
                    }, 'building');
                  } catch(e) {
                    window.map.addLayer({
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
                }

                // Move camera BEFORE loading terrain tiles
                window.map.jumpTo({
                  center: camera.center,
                  zoom: camera.zoom,
                  bearing: camera.bearing,
                  pitch: camera.pitch,
                });

                window._rn_log('Terrain + camera set, waiting for tiles...');

                // Wait for terrain tiles to load FIRST
                var tileRetries = 0;
                var maxTileRetries = 40;

                function waitForTiles() {
                  if (isStale()) { window._rn_log('gen=' + myGen + ' superseded in waitForTiles, aborting'); return; }
                  tileRetries++;
                  if (window.map.loaded() && window.map.areTilesLoaded()) {
                    window._rn_log('Tiles loaded after ' + tileRetries + ' polls, adding route...');
                    addRouteAndCapture();
                  } else if (tileRetries >= maxTileRetries) {
                    window._rn_log('Tiles timeout, adding route anyway...');
                    addRouteAndCapture();
                  } else {
                    setTimeout(waitForTiles, 250);
                  }
                }

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
                      window._rn_log('Map idle, capturing...');
                      // Extra frame to ensure GPU has painted the route
                      requestAnimationFrame(function() {
                        setTimeout(captureSnapshot, 50);
                      });
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
                      activityId: activityId,
                      mapStyle: mapStyle,
                      gen: myGen,
                      base64: base64,
                    }));
                  } catch(e) {
                    window._rn_log('Capture error: ' + e.message);
                    window.ReactNativeWebView.postMessage(JSON.stringify({
                      type: 'snapshotError',
                      activityId: activityId,
                      gen: myGen,
                      error: e.message,
                    }));
                  }
                }

                waitForTiles();
              } catch(e) {
                window._rn_log('onStyleReady error: ' + e.message);
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: 'snapshotError',
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
                activityId: '${request.activityId}',
                gen: ${gen},
                error: e.message,
              }));
            }
          }
        })();
        true;
      `);

      // Timeout fallback
      timeoutRef.current = setTimeout(() => {
        if (processingRef.current) {
          console.warn(
            `[TerrainSnapshot] Timeout for ${request.activityId} gen=${gen} (${SNAPSHOT_TIMEOUT_MS}ms)`
          );
          processingRef.current = false;
          currentRequestRef.current = null;
          processNext();
        }
      }, SNAPSHOT_TIMEOUT_MS);
    }, []);

    const handleMessage = useCallback(
      async (event: { nativeEvent: { data: string } }) => {
        try {
          const data = JSON.parse(event.nativeEvent.data);
          if (typeof data !== 'object' || data === null || typeof data.type !== 'string') return;

          if (data.type === 'console') {
            // Bridge WebView console to RN
            console.log(`[TerrainSnapshot:JS] ${data.message}`);
          } else if (data.type === 'mapReady') {
            console.log('[TerrainSnapshot] WebView map ready');
            mapReadyRef.current = true;
            processNext();
          } else if (data.type === 'snapshot' && data.activityId && data.base64) {
            // Discard stale snapshots from superseded requests
            if (typeof data.gen === 'number' && data.gen !== generationRef.current) {
              console.warn(
                `[TerrainSnapshot] Discarding stale snapshot for ${data.activityId} (gen=${data.gen}, current=${generationRef.current})`
              );
              return;
            }

            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            // Use style from the JS response (authoritative) instead of currentRequestRef
            const style =
              (data.mapStyle as MapStyleType) ?? currentRequestRef.current?.mapStyle ?? 'light';
            processingRef.current = false;
            currentRequestRef.current = null;

            console.log(
              `[TerrainSnapshot] Captured ${data.activityId} (${Math.round(data.base64.length / 1024)}KB base64)`
            );
            const uri = await saveTerrainPreview(data.activityId, style, data.base64);
            console.log(`[TerrainSnapshot] Saved ${data.activityId} → ${uri}`);
            emitSnapshotComplete(data.activityId, uri);
            processNext();
          } else if (data.type === 'snapshotError') {
            // Discard stale errors from superseded requests
            if (typeof data.gen === 'number' && data.gen !== generationRef.current) {
              console.warn(
                `[TerrainSnapshot] Discarding stale error for ${data.activityId} (gen=${data.gen}, current=${generationRef.current})`
              );
              return;
            }

            console.warn(`[TerrainSnapshot] Error for ${data.activityId}: ${data.error}`);
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            processingRef.current = false;
            currentRequestRef.current = null;
            processNext();
          }
        } catch {
          // Ignore parse errors
        }
      },
      [processNext]
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

    // HTML that initializes MapLibre with preserveDrawingBuffer and console bridge
    const html = `
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
    // Bridge console to React Native
    window._rn_log = function(msg) {
      try {
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'console',
            message: String(msg)
          }));
        }
      } catch(e) {}
    };

    // Generation counter for race condition guard
    window._snapshotGen = 0;

    window._rn_log('Initializing MapLibre...');

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
      window._rn_log('Map loaded OK');
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'mapReady' }));
      }
    });

    window.map.on('error', function(e) {
      window._rn_log('Map error: ' + (e.error ? e.error.message : JSON.stringify(e)));
    });
  </script>
</body>
</html>`;

    return (
      <View style={styles.container} pointerEvents="none">
        <WebView
          ref={webViewRef}
          source={{ html, baseUrl: 'https://veloq.fit/' }}
          style={styles.webview}
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
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});
