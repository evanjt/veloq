/**
 * Hidden WebView that renders 3D terrain maps and captures JPEG snapshots.
 *
 * Rendered once in the feed screen, behind content (zIndex: -1, opacity: 0).
 * Processes a queue of snapshot requests one at a time. Uses polling to detect
 * when MapLibre has finished loading, then captures via `canvas.toDataURL()`.
 */

import React, { useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import { WebView } from 'react-native-webview';
import type { MapStyleType } from './mapStyles';
import { getCombinedSatelliteStyle } from './mapStyles';
import { DARK_MATTER_STYLE } from './darkMatterStyle';
import type { TerrainCamera } from '@/lib/utils/cameraAngle';
import { saveTerrainPreview, hasTerrainPreview } from '@/lib/storage/terrainPreviewCache';

const SNAPSHOT_TIMEOUT_MS = 20000;
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

interface Props {
  /** Called when a snapshot is saved for an activity */
  onSnapshotComplete?: (activityId: string, uri: string) => void;
}

export const TerrainSnapshotWebView = forwardRef<TerrainSnapshotWebViewRef, Props>(
  function TerrainSnapshotWebView({ onSnapshotComplete }, ref) {
    const webViewRef = useRef<WebView>(null);
    const queueRef = useRef<SnapshotRequest[]>([]);
    const processingRef = useRef(false);
    const mapReadyRef = useRef(false);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const currentRequestRef = useRef<SnapshotRequest | null>(null);

    const processNext = useCallback(() => {
      if (processingRef.current || !mapReadyRef.current) return;
      if (queueRef.current.length === 0) return;

      const request = queueRef.current.shift()!;

      // Skip if already cached
      if (hasTerrainPreview(request.activityId)) {
        processNext();
        return;
      }

      processingRef.current = true;
      currentRequestRef.current = request;
      console.log(
        `[TerrainSnapshot] Processing ${request.activityId} (style: ${request.mapStyle})`
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

      // Inject render command using polling (proven pattern from Map3DWebView)
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

            window._rn_log('Setting style for ' + activityId);

            // Remove existing layers/sources
            try {
              if (window.map.getLayer('route-line')) window.map.removeLayer('route-line');
              if (window.map.getLayer('route-outline')) window.map.removeLayer('route-outline');
              if (window.map.getSource('route')) window.map.removeSource('route');
              if (window.map.getLayer('sky')) window.map.removeLayer('sky');
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

            // Poll for style to be loaded (reliable, avoids style.load race condition)
            var styleRetries = 0;
            var maxStyleRetries = 50; // 50 * 200ms = 10s max

            function waitForStyle() {
              styleRetries++;
              if (window.map.isStyleLoaded()) {
                window._rn_log('Style loaded after ' + styleRetries + ' polls');
                onStyleReady();
              } else if (styleRetries >= maxStyleRetries) {
                window._rn_log('Style load timeout after ' + maxStyleRetries + ' polls');
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: 'snapshotError',
                  activityId: activityId,
                  error: 'Style load timeout',
                }));
              } else {
                setTimeout(waitForStyle, 200);
              }
            }

            function onStyleReady() {
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

                // Sky layer
                window.map.addLayer({
                  id: 'sky',
                  type: 'sky',
                  paint: {
                    'sky-type': 'atmosphere',
                    'sky-atmosphere-sun': [0.0, 90.0],
                    'sky-atmosphere-sun-intensity': 15,
                  },
                });

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

                // Add route
                if (coords.length > 0) {
                  window.map.addSource('route', {
                    type: 'geojson',
                    data: {
                      type: 'Feature',
                      properties: {},
                      geometry: { type: 'LineString', coordinates: coords },
                    },
                  });
                  window.map.addLayer({
                    id: 'route-outline',
                    type: 'line',
                    source: 'route',
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: { 'line-color': '#FFFFFF', 'line-width': 6, 'line-opacity': 0.8 },
                  });
                  window.map.addLayer({
                    id: 'route-line',
                    type: 'line',
                    source: 'route',
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: { 'line-color': routeColor, 'line-width': 4 },
                  });
                }

                // Move camera
                window.map.jumpTo({
                  center: camera.center,
                  zoom: camera.zoom,
                  bearing: camera.bearing,
                  pitch: camera.pitch,
                });

                window._rn_log('Layers added, waiting for tiles...');

                // Poll for all tiles to load, then capture
                var tileRetries = 0;
                var maxTileRetries = 40; // 40 * 250ms = 10s max

                function waitForTiles() {
                  tileRetries++;
                  if (window.map.loaded() && window.map.areTilesLoaded()) {
                    window._rn_log('Tiles loaded after ' + tileRetries + ' polls, capturing...');
                    // Small delay for final render
                    setTimeout(captureSnapshot, 100);
                  } else if (tileRetries >= maxTileRetries) {
                    window._rn_log('Tiles timeout, capturing anyway...');
                    captureSnapshot();
                  } else {
                    setTimeout(waitForTiles, 250);
                  }
                }

                function captureSnapshot() {
                  try {
                    var canvas = window.map.getCanvas();
                    var dataUrl = canvas.toDataURL('image/jpeg', 0.85);
                    var base64 = dataUrl.split(',')[1];
                    window._rn_log('Captured ' + activityId + ' (' + Math.round(base64.length / 1024) + 'KB)');
                    window.ReactNativeWebView.postMessage(JSON.stringify({
                      type: 'snapshot',
                      activityId: activityId,
                      base64: base64,
                    }));
                  } catch(e) {
                    window._rn_log('Capture error: ' + e.message);
                    window.ReactNativeWebView.postMessage(JSON.stringify({
                      type: 'snapshotError',
                      activityId: activityId,
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
            `[TerrainSnapshot] Timeout for ${request.activityId} (${SNAPSHOT_TIMEOUT_MS}ms)`
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
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            processingRef.current = false;
            currentRequestRef.current = null;

            console.log(
              `[TerrainSnapshot] Captured ${data.activityId} (${Math.round(data.base64.length / 1024)}KB base64)`
            );
            const uri = await saveTerrainPreview(data.activityId, data.base64);
            console.log(`[TerrainSnapshot] Saved ${data.activityId} → ${uri}`);
            onSnapshotComplete?.(data.activityId, uri);
            processNext();
          } else if (data.type === 'snapshotError') {
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
      [onSnapshotComplete, processNext]
    );

    useImperativeHandle(
      ref,
      () => ({
        requestSnapshot: (request: SnapshotRequest) => {
          // Deduplicate: skip if already cached or already in queue
          if (hasTerrainPreview(request.activityId)) return;
          if (queueRef.current.some((r) => r.activityId === request.activityId)) return;

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

    window._rn_log('Initializing MapLibre...');

    window.map = new maplibregl.Map({
      container: 'map',
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: [8.5, 47.3],
      zoom: 10,
      pitch: 60,
      attributionControl: false,
      preserveDrawingBuffer: true,
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
