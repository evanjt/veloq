import React, {
  useMemo,
  useRef,
  useImperativeHandle,
  forwardRef,
  useEffect,
  useCallback,
} from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import { colors, darkColors } from '@/theme/colors';
import { getBoundsFromPoints } from '@/lib';
import type { MapStyleType } from './mapStyles';
import { getCombinedSatelliteStyle, SATELLITE_SOURCES } from './mapStyles';
import { DARK_MATTER_STYLE } from './darkMatterStyle';
import { SWITZERLAND_SIMPLE } from './countryBoundaries';

// Stable empty array to prevent unnecessary re-renders when coordinates prop is undefined
const EMPTY_COORDS: [number, number][] = [];

interface Map3DWebViewProps {
  /** Route coordinates as [lng, lat] pairs (optional - if not provided, just shows terrain) */
  coordinates?: [number, number][];
  /** Map theme */
  mapStyle: MapStyleType;
  /** Route line color */
  routeColor?: string;
  /** Initial camera pitch in degrees (0-85) */
  initialPitch?: number;
  /** Terrain exaggeration factor */
  terrainExaggeration?: number;
  /** Initial center as [lng, lat] - used when no coordinates provided */
  initialCenter?: [number, number];
  /** Initial zoom level - used when no coordinates provided */
  initialZoom?: number;
  /** GeoJSON for routes layer */
  routesGeoJSON?: GeoJSON.FeatureCollection;
  /** GeoJSON for sections layer */
  sectionsGeoJSON?: GeoJSON.FeatureCollection;
  /** GeoJSON for traces layer */
  tracesGeoJSON?: GeoJSON.FeatureCollection;
}

export interface Map3DWebViewRef {
  /** Reset bearing to north and pitch to look straight down */
  resetOrientation: () => void;
}

interface Map3DWebViewPropsInternal extends Map3DWebViewProps {
  /** Called when the map has finished loading */
  onMapReady?: () => void;
  /** Called when bearing changes (for compass sync) */
  onBearingChange?: (bearing: number) => void;
}

/**
 * 3D terrain map using MapLibre GL JS in a WebView.
 * Uses free AWS Terrain Tiles (no API key required).
 * Supports light, dark, and satellite base styles.
 *
 * ARCHITECTURE NOTE: GeoJSON layers are updated dynamically via injectJavaScript
 * to avoid WebView reloads when toggling visibility. Only mapStyle changes trigger
 * a full reload, which preserves camera position via savedCamera.
 */
export const Map3DWebView = forwardRef<Map3DWebViewRef, Map3DWebViewPropsInternal>(
  function Map3DWebView(
    {
      coordinates = EMPTY_COORDS,
      mapStyle,
      routeColor = colors.primary,
      initialPitch = 60,
      terrainExaggeration = 1.5,
      initialCenter,
      initialZoom = 12,
      routesGeoJSON,
      sectionsGeoJSON,
      tracesGeoJSON,
      onMapReady,
      onBearingChange,
    },
    ref
  ) {
    const webViewRef = useRef<WebView>(null);
    const mapReadyRef = useRef(false);
    // Track camera state for restoration after style changes
    const savedCameraRef = useRef<{
      center: [number, number];
      zoom: number;
      bearing: number;
      pitch: number;
    } | null>(null);

    // Store GeoJSON data in refs to avoid stale closures
    const routesGeoJSONRef = useRef(routesGeoJSON);
    const sectionsGeoJSONRef = useRef(sectionsGeoJSON);
    const tracesGeoJSONRef = useRef(tracesGeoJSON);

    // Store initial center/zoom in refs - only used on first render
    // This prevents HTML regeneration when parent updates these values
    const initialCenterRef = useRef(initialCenter);
    const initialZoomRef = useRef(initialZoom);

    // Keep refs in sync with props
    useEffect(() => {
      routesGeoJSONRef.current = routesGeoJSON;
      sectionsGeoJSONRef.current = sectionsGeoJSON;
      tracesGeoJSONRef.current = tracesGeoJSON;
    }, [routesGeoJSON, sectionsGeoJSON, tracesGeoJSON]);

    // Update GeoJSON layers dynamically without reloading WebView
    // Reads from refs to avoid stale closure issues
    // Uses retry mechanism to handle style loading race conditions
    const updateLayers = useCallback(() => {
      if (!webViewRef.current || !mapReadyRef.current) return;

      const routesJSON = routesGeoJSONRef.current
        ? JSON.stringify(routesGeoJSONRef.current)
        : 'null';
      const sectionsJSON = sectionsGeoJSONRef.current
        ? JSON.stringify(sectionsGeoJSONRef.current)
        : 'null';
      const tracesJSON = tracesGeoJSONRef.current
        ? JSON.stringify(tracesGeoJSONRef.current)
        : 'null';

      webViewRef.current.injectJavaScript(`
        (function() {
          var retryCount = 0;
          var maxRetries = 5;

          function addOrUpdateLayers() {
            if (!window.map) return;

            // If style isn't loaded yet or map is still loading, wait
            if (!window.map.isStyleLoaded() || !window.map.loaded()) {
              retryCount++;
              if (retryCount <= maxRetries) {
                console.log('[3D] Style/tiles not ready, retry ' + retryCount + '/' + maxRetries);
                setTimeout(addOrUpdateLayers, 200 * retryCount);
              } else {
                console.log('[3D] Max retries reached, forcing layer update');
                window.map.once('idle', addOrUpdateLayers);
              }
              return;
            }

            const routesData = ${routesJSON};
            const sectionsData = ${sectionsJSON};
            const tracesData = ${tracesJSON};

            // Helper to safely add or update a layer
            function updateLayer(sourceId, layerId, data, layerConfig) {
              const sourceExists = !!window.map.getSource(sourceId);
              const hasData = data && data.features && data.features.length > 0;

              try {
                if (sourceExists) {
                  if (hasData) {
                    window.map.getSource(sourceId).setData(data);
                    window.map.setLayoutProperty(layerId, 'visibility', 'visible');
                  } else {
                    window.map.setLayoutProperty(layerId, 'visibility', 'none');
                  }
                } else if (hasData) {
                  window.map.addSource(sourceId, { type: 'geojson', data: data });
                  window.map.addLayer(layerConfig);
                }
              } catch (e) {
                console.warn('Layer error:', sourceId, e);
              }
            }

            // Helper to add layer with outline for visibility on all map styles
            function addLayerWithOutline(sourceId, layerId, data, lineColor, lineWidth, lineOpacity) {
              const sourceExists = !!window.map.getSource(sourceId);
              const hasData = data && data.features && data.features.length > 0;
              const outlineId = layerId + '-outline';

              try {
                if (sourceExists) {
                  if (hasData) {
                    window.map.getSource(sourceId).setData(data);
                    window.map.setLayoutProperty(outlineId, 'visibility', 'visible');
                    window.map.setLayoutProperty(layerId, 'visibility', 'visible');
                  } else {
                    window.map.setLayoutProperty(outlineId, 'visibility', 'none');
                    window.map.setLayoutProperty(layerId, 'visibility', 'none');
                  }
                } else if (hasData) {
                  window.map.addSource(sourceId, { type: 'geojson', data: data });
                  // Add outline first (renders behind)
                  window.map.addLayer({
                    id: outlineId,
                    type: 'line',
                    source: sourceId,
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: { 'line-color': '#FFFFFF', 'line-width': lineWidth + 2, 'line-opacity': lineOpacity * 0.6 },
                  });
                  // Add main line on top
                  window.map.addLayer({
                    id: layerId,
                    type: 'line',
                    source: sourceId,
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: { 'line-color': lineColor, 'line-width': lineWidth, 'line-opacity': lineOpacity },
                  });
                }
              } catch (e) {
                console.warn('Layer error:', sourceId, e);
              }
            }

            // Update routes layer (with outline for visibility) - purple to match 2D
            addLayerWithOutline('routes-source', 'routes-layer', routesData, '#9C27B0', 3, 0.8);

            // Update sections layer - vibrant green for visibility on all map styles
            // Don't use sportType color as it may fall back to dark gray
            addLayerWithOutline('sections-source', 'sections-layer', sectionsData, '#4CAF50', 5, 0.9);

            // Update traces layer (activity GPS tracks) - use color from GeoJSON
            addLayerWithOutline('traces-source', 'traces-layer', tracesData, ['get', 'color'], 2, 0.7);

            console.log('[3D] Layers updated - routes:', routesData?.features?.length || 0,
                        'sections:', sectionsData?.features?.length || 0,
                        'traces:', tracesData?.features?.length || 0);
          }

          addOrUpdateLayers();
        })();
        true;
      `);
    }, []);

    // Handle messages from WebView
    const handleMessage = useCallback(
      (event: { nativeEvent: { data: string } }) => {
        try {
          const data = JSON.parse(event.nativeEvent.data);
          // Validate message structure before using
          if (typeof data !== 'object' || data === null || typeof data.type !== 'string') {
            return;
          }
          if (data.type === 'mapReady') {
            mapReadyRef.current = true;
            onMapReady?.();
            // Update layers after map is ready - small delay ensures style is fully settled
            setTimeout(() => updateLayers(), 100);
          } else if (data.type === 'bearingChange' && typeof data.bearing === 'number') {
            onBearingChange?.(data.bearing);
          } else if (data.type === 'cameraState' && data.camera) {
            // Save camera state for restoration
            savedCameraRef.current = data.camera;
          }
        } catch {
          // Ignore parse errors
        }
      },
      [onMapReady, onBearingChange, updateLayers]
    );

    // Update layers when GeoJSON props change (without reloading WebView)
    useEffect(() => {
      if (mapReadyRef.current) {
        updateLayers();
      }
    }, [routesGeoJSON, sectionsGeoJSON, tracesGeoJSON, updateLayers]);

    // Expose reset method to parent
    useImperativeHandle(
      ref,
      () => ({
        resetOrientation: () => {
          webViewRef.current?.injectJavaScript(`
        if (window.map) {
          window.map.easeTo({
            bearing: 0,
            pitch: 0,
            duration: 500
          });
        }
        true;
      `);
        },
      }),
      []
    );

    // Calculate bounds from coordinates using utility
    // Coordinates are in [lng, lat] format, convert to {lat, lng} for utility
    const bounds = useMemo(() => {
      if (coordinates.length === 0) return null;

      // Convert [lng, lat] tuples to {lat, lng} objects
      const points = coordinates.map(([lng, lat]) => ({ lat, lng }));

      // Use utility with 10% padding
      return getBoundsFromPoints(points, 0.1);
    }, [coordinates]);

    // Use initial center/zoom when no coordinates provided
    const hasRoute = coordinates.length > 0;

    // Generate the HTML for the WebView
    // IMPORTANT: Only depends on style-related props, NOT GeoJSON data
    // GeoJSON layers are updated dynamically via injectJavaScript
    const html = useMemo(() => {
      // Reset map ready state when HTML regenerates
      mapReadyRef.current = false;

      const coordsJSON = JSON.stringify(coordinates);
      const boundsJSON = bounds ? JSON.stringify(bounds) : 'null';
      // Use saved camera position if available (from previous style), otherwise use initial
      // Read from refs to avoid HTML regeneration when parent updates center/zoom
      const savedCamera = savedCameraRef.current;
      const centerJSON = savedCamera
        ? JSON.stringify(savedCamera.center)
        : initialCenterRef.current
          ? JSON.stringify(initialCenterRef.current)
          : 'null';
      const zoomValue = savedCamera ? savedCamera.zoom : (initialZoomRef.current ?? 12);
      const bearingValue = savedCamera ? savedCamera.bearing : 0;
      const pitchValue = savedCamera ? savedCamera.pitch : initialPitch;
      const isSatellite = mapStyle === 'satellite';
      const isDark = mapStyle === 'dark' || mapStyle === 'satellite';

      // For satellite, we use combined style with all regional sources layered
      // For dark, we use the bundled Dark Matter style with OpenFreeMap tiles
      const styleConfig = isSatellite
        ? JSON.stringify(getCombinedSatelliteStyle())
        : mapStyle === 'dark'
          ? JSON.stringify(DARK_MATTER_STYLE)
          : `'https://tiles.openfreemap.org/styles/liberty'`;

      return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>3D Map</title>
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
    const coordinates = ${coordsJSON};
    const bounds = ${boundsJSON};
    const center = ${centerJSON};
    const savedZoom = ${zoomValue};
    const savedBearing = ${bearingValue};
    const savedPitch = ${pitchValue};
    const isSatellite = ${isSatellite};

    // Create map with appropriate style
    // Use saved camera state if available, otherwise use bounds or center/zoom
    const mapOptions = {
      container: 'map',
      style: ${styleConfig},
      pitch: savedPitch,
      maxPitch: 85,
      bearing: savedBearing,
      attributionControl: false,
    };

    // Only use bounds for initial load (no saved camera)
    if (bounds && !${!!savedCamera}) {
      mapOptions.bounds = [bounds.sw, bounds.ne];
      mapOptions.fitBoundsOptions = { padding: 50 };
    } else if (center) {
      mapOptions.center = center;
      mapOptions.zoom = savedZoom;
    } else {
      mapOptions.center = [0, 0];
      mapOptions.zoom = 2;
    }

    window.map = new maplibregl.Map(mapOptions);

    const map = window.map;

    // Track camera changes and save state for restoration
    function saveCameraState() {
      if (window.ReactNativeWebView) {
        const center = map.getCenter();
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'cameraState',
          camera: {
            center: [center.lng, center.lat],
            zoom: map.getZoom(),
            bearing: map.getBearing(),
            pitch: map.getPitch()
          }
        }));
      }
    }

    // Track bearing changes and notify React Native
    map.on('rotate', () => {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'bearingChange',
          bearing: map.getBearing()
        }));
      }
    });

    // Save camera state on any movement
    map.on('moveend', saveCameraState);
    map.on('zoomend', saveCameraState);
    map.on('rotateend', saveCameraState);
    map.on('pitchend', saveCameraState);

    map.on('load', () => {
      // Notify React Native that map is ready
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'mapReady' }));
      }

      // Add AWS Terrain Tiles source (free, no API key)
      map.addSource('terrain', {
        type: 'raster-dem',
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 15,
      });

      // Enable 3D terrain
      map.setTerrain({
        source: 'terrain',
        exaggeration: ${terrainExaggeration},
      });

      // Add sky layer for atmosphere effect
      map.addLayer({
        id: 'sky',
        type: 'sky',
        paint: {
          'sky-type': 'atmosphere',
          'sky-atmosphere-sun': [0.0, 90.0],
          'sky-atmosphere-sun-intensity': 15,
        },
      });

      // Add hillshade for better depth perception (skip for satellite - already has shadows)
      // Reuses the existing 'terrain' raster-dem source to avoid downloading tiles twice
      if (!isSatellite) {
        map.addLayer({
          id: 'hillshading',
          type: 'hillshade',
          source: 'terrain',
          layout: { visibility: 'visible' },
          paint: {
            'hillshade-shadow-color': '${isDark ? '#000000' : '#473B24'}',
            'hillshade-illumination-anchor': 'map',
            'hillshade-exaggeration': 0.3,
          },
        }, 'building');
      }

      // Add route if coordinates exist
      if (coordinates.length > 0) {
        map.addSource('route', {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: coordinates,
            },
          },
        });

        // Route outline (for contrast)
        map.addLayer({
          id: 'route-outline',
          type: 'line',
          source: 'route',
          layout: {
            'line-join': 'round',
            'line-cap': 'round',
          },
          paint: {
            'line-color': '#FFFFFF',
            'line-width': 6,
            'line-opacity': 0.8,
          },
        });

        // Route line
        map.addLayer({
          id: 'route-line',
          type: 'line',
          source: 'route',
          layout: {
            'line-join': 'round',
            'line-cap': 'round',
          },
          paint: {
            'line-color': '${routeColor}',
            'line-width': 4,
          },
        });
      }

      // GeoJSON layers (routes, sections, traces) are added dynamically via injectJavaScript
      // after mapReady message is received by React Native
    });
  </script>
</body>
</html>
    `;
    }, [
      coordinates,
      bounds,
      // NOTE: initialCenter and initialZoom are stored in refs to prevent HTML regeneration
      // when parent updates these values (e.g., from 2D map interactions)
      mapStyle,
      routeColor,
      initialPitch,
      terrainExaggeration,
      // NOTE: GeoJSON props are NOT dependencies - they're updated via injectJavaScript
    ]);

    return (
      <View style={styles.container}>
        <WebView
          ref={webViewRef}
          source={{ html, baseUrl: 'https://veloq.fit/' }}
          style={styles.webview}
          scrollEnabled={false}
          bounces={false}
          overScrollMode="never"
          nestedScrollEnabled={true}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          startInLoadingState={false}
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
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
    flex: 1,
    backgroundColor: darkColors.background,
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});
