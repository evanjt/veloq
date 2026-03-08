import React, {
  useMemo,
  useRef,
  useImperativeHandle,
  forwardRef,
  useEffect,
  useCallback,
} from 'react';
import { View, StyleSheet, PixelRatio } from 'react-native';
import { WebView } from 'react-native-webview';
import { colors, darkColors } from '@/theme';
import { getBoundsFromPoints } from '@/lib';
import type { MapStyleType } from './mapStyles';
import { getCombinedSatelliteStyle3D, SATELLITE_SOURCES } from './mapStyles';
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
  /** Called when the full camera state updates (center, zoom, bearing, pitch) */
  onCameraStateChange?: (camera: {
    center: [number, number];
    zoom: number;
    bearing: number;
    pitch: number;
  }) => void;
  /** Saved camera override — if provided, skips fitBounds and uses this on first load */
  initialCamera?: {
    center: [number, number];
    zoom: number;
    bearing: number;
    pitch: number;
  } | null;
}

/**
 * 3D terrain map using MapLibre GL JS in a WebView.
 * Uses free AWS Terrain Tiles (no API key required).
 * Supports light, dark, and satellite base styles.
 *
 * ARCHITECTURE NOTE: GeoJSON layers and style changes are applied dynamically via
 * injectJavaScript to avoid WebView reloads. Style changes use map.setStyle() with
 * terrain/sky/route layers embedded atomically. The WebView HTML is only regenerated
 * when coordinates or pitch/exaggeration change.
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
      onCameraStateChange,
      initialCamera,
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

    // Store initial center/zoom/camera in refs - only used on first render
    // This prevents HTML regeneration when parent updates these values
    const initialCenterRef = useRef(initialCenter);
    const initialZoomRef = useRef(initialZoom);
    const initialCameraRef = useRef(initialCamera);
    // Track mapStyle in ref — style changes are applied via setStyle() injection
    const mapStyleRef = useRef(mapStyle);
    const initialMapStyleRef = useRef(mapStyle);

    // Cleanup on unmount — stop WebView loading and mark map as not ready
    useEffect(() => {
      return () => {
        mapReadyRef.current = false;
        webViewRef.current?.stopLoading();
      };
    }, []);

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
            onCameraStateChange?.(data.camera);
          }
        } catch {
          // Ignore parse errors
        }
      },
      [onMapReady, onBearingChange, onCameraStateChange, updateLayers]
    );

    // Update layers when GeoJSON props change (without reloading WebView)
    useEffect(() => {
      if (mapReadyRef.current) {
        updateLayers();
      }
    }, [routesGeoJSON, sectionsGeoJSON, tracesGeoJSON, updateLayers]);

    // Apply style changes via setStyle() injection — avoids full WebView reload.
    // Builds a complete style object with terrain, sky, hillshade, and route layers,
    // then applies atomically via map.setStyle() (same pattern as TerrainSnapshotWebView).
    useEffect(() => {
      // Skip when style hasn't actually changed from what's rendered
      if (mapStyle === mapStyleRef.current) return;
      mapStyleRef.current = mapStyle;

      if (!webViewRef.current || !mapReadyRef.current) return;

      const isSatellite = mapStyle === 'satellite';
      const isDark = mapStyle === 'dark' || mapStyle === 'satellite';

      const styleConfig = isSatellite
        ? JSON.stringify(getCombinedSatelliteStyle3D())
        : mapStyle === 'dark'
          ? JSON.stringify(DARK_MATTER_STYLE)
          : `null`; // light uses URL-based style, handled below

      const lightStyleUrl = 'https://tiles.openfreemap.org/styles/liberty';

      webViewRef.current.injectJavaScript(`
        (function() {
          if (!window.map) return;

          var isSatellite = ${isSatellite};
          var isDark = ${isDark};
          var coords = window._routeCoords || [];
          var routeColor = '${routeColor}';

          // Build style: either JSON object or fetch URL-based style
          function applyNewStyle(styleObj) {
            // Add terrain source via cached protocol
            styleObj.sources['terrain'] = {
              type: 'raster-dem',
              tiles: ['cached-terrain://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
              encoding: 'terrarium',
              tileSize: 256,
              maxzoom: 15,
            };

            styleObj.terrain = { source: 'terrain', exaggeration: ${terrainExaggeration} };

            // Sky config embedded in style JSON (not via setSky — avoids MapLibre bug)
            styleObj.sky = isSatellite
              ? { 'sky-color': '#1a3a5c', 'horizon-color': '#2a4a6c', 'fog-color': '#1a3050',
                  'fog-ground-blend': 0.5, 'horizon-fog-blend': 0.8, 'sky-horizon-blend': 0.5, 'atmosphere-blend': 0.8 }
              : isDark
              ? { 'sky-color': '#0a0a14', 'horizon-color': '#151520', 'fog-color': '#0a0a14',
                  'fog-ground-blend': 0.5, 'horizon-fog-blend': 0.8, 'sky-horizon-blend': 0.5, 'atmosphere-blend': 0.8 }
              : { 'sky-color': '#88C6FC', 'horizon-color': '#B0C8DC', 'fog-color': '#D8E4EE',
                  'fog-ground-blend': 0.5, 'horizon-fog-blend': 0.8, 'sky-horizon-blend': 0.5, 'atmosphere-blend': 0.8 };

            // Hillshade for non-satellite styles
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

            // Re-add route layers if route exists
            if (coords.length > 0) {
              var startPt = coords[0];
              var endPt = coords[coords.length - 1];

              styleObj.sources['route'] = {
                type: 'geojson',
                data: { type: 'Feature', properties: {},
                  geometry: { type: 'LineString', coordinates: coords } },
                tolerance: 0,
              };
              styleObj.sources['start-end-markers'] = {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [
                  { type: 'Feature', properties: { type: 'start' }, geometry: { type: 'Point', coordinates: startPt } },
                  { type: 'Feature', properties: { type: 'end' }, geometry: { type: 'Point', coordinates: endPt } },
                ]},
              };
              styleObj.layers.push(
                { id: 'route-outline', type: 'line', source: 'route',
                  layout: { 'line-join': 'round', 'line-cap': 'round' },
                  paint: { 'line-color': '#FFFFFF', 'line-width': 8, 'line-opacity': 0.8 } },
                { id: 'route-line', type: 'line', source: 'route',
                  layout: { 'line-join': 'round', 'line-cap': 'round' },
                  paint: { 'line-color': routeColor, 'line-width': 5 } },
                { id: 'start-end-border', type: 'circle', source: 'start-end-markers',
                  paint: { 'circle-radius': 7, 'circle-color': '#FFFFFF' } },
                { id: 'start-end-fill', type: 'circle', source: 'start-end-markers',
                  paint: { 'circle-radius': 5,
                    'circle-color': ['case', ['==', ['get', 'type'], 'start'], 'rgba(34,197,94,0.75)', 'rgba(239,68,68,0.75)'] } }
              );
            }

            window.map.setStyle(styleObj);
            console.log('[3D] Style changed via setStyle()');
          }

          var styleJSON = ${styleConfig};
          if (styleJSON) {
            applyNewStyle(styleJSON);
          } else {
            // Light style is URL-based — fetch it first, then apply modifications
            fetch('${lightStyleUrl}')
              .then(function(r) { return r.json(); })
              .then(function(s) { applyNewStyle(s); })
              .catch(function(e) { console.warn('[3D] Failed to fetch light style:', e); });
          }
        })();
        true;
      `);

      // After style change, re-apply GeoJSON overlay layers once the new style settles
      setTimeout(() => updateLayers(), 500);
    }, [mapStyle, routeColor, terrainExaggeration, updateLayers]);

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

      const devicePixelRatio = Math.min(PixelRatio.get(), 2); // Cap at 2x for 3D terrain
      const coordsJSON = JSON.stringify(coordinates);
      const boundsJSON = bounds ? JSON.stringify(bounds) : 'null';
      // Use saved camera position if available (from previous style change),
      // then fall back to initialCamera override (from parent), then to initial props.
      const savedCamera = savedCameraRef.current ?? initialCameraRef.current;
      const centerJSON = savedCamera
        ? JSON.stringify(savedCamera.center)
        : initialCenterRef.current
          ? JSON.stringify(initialCenterRef.current)
          : 'null';
      const zoomValue = savedCamera ? savedCamera.zoom : (initialZoomRef.current ?? 12);
      const bearingValue = savedCamera ? savedCamera.bearing : 0;
      const pitchValue = savedCamera ? savedCamera.pitch : initialPitch;
      // Use initial style ref for HTML generation — subsequent style changes
      // are handled via setStyle() injection without regenerating HTML
      const initStyle = initialMapStyleRef.current;
      const isSatellite = initStyle === 'satellite';
      const isDark = initStyle === 'dark' || initStyle === 'satellite';

      // For satellite, we use combined style with all regional sources layered
      // For dark, we use the bundled Dark Matter style with OpenFreeMap tiles
      const styleConfig = isSatellite
        ? JSON.stringify(getCombinedSatelliteStyle3D())
        : initStyle === 'dark'
          ? JSON.stringify(DARK_MATTER_STYLE)
          : `'https://tiles.openfreemap.org/styles/liberty'`;

      return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>3D Map</title>
  <script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
  <link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet" />
  <style>
    body { margin: 0; padding: 0; overflow: hidden; }
    #map { width: 100vw; height: 100vh; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    const coordinates = ${coordsJSON};
    window._routeCoords = coordinates;
    const bounds = ${boundsJSON};
    const center = ${centerJSON};
    const savedZoom = ${zoomValue};
    const savedBearing = ${bearingValue};
    const savedPitch = ${pitchValue};
    const isSatellite = ${isSatellite};

    // Cache terrain DEM tiles via Cache API — persists across WebView recreations
    // because baseUrl is https://veloq.fit/ (stable HTTPS origin).
    // Protocol name is forward-compatible with future Rust tile cache (ROADMAP 7.3).
    var TERRAIN_CACHE = 'veloq-terrain-dem-v1';
    maplibregl.addProtocol('cached-terrain', function(params, callback) {
      var realUrl = 'https://' + params.url.substring('cached-terrain://'.length);
      caches.open(TERRAIN_CACHE).then(function(cache) {
        return cache.match(realUrl).then(function(cached) {
          if (cached) return cached.arrayBuffer().then(function(d) { callback(null, d, null, null); });
          return fetch(realUrl).then(function(r) {
            if (r.ok) { cache.put(realUrl, r.clone()); return r.arrayBuffer().then(function(d) { callback(null, d, null, null); }); }
            callback(new Error('HTTP ' + r.status));
          });
        });
      }).catch(function() {
        fetch(realUrl).then(function(r) { return r.arrayBuffer(); })
          .then(function(d) { callback(null, d, null, null); })
          .catch(function(e) { callback(e); });
      });
      return { cancel: function() {} };
    });

    // Create map with appropriate style
    // Use saved camera state if available, otherwise use bounds or center/zoom
    const mapOptions = {
      container: 'map',
      style: ${styleConfig},
      pitch: savedPitch,
      maxPitch: 85,
      bearing: savedBearing,
      attributionControl: false,
      antialias: true,
      pixelRatio: ${devicePixelRatio},
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
      // Add AWS Terrain Tiles source via cached-terrain:// protocol
      map.addSource('terrain', {
        type: 'raster-dem',
        tiles: ['cached-terrain://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 15,
      });

      // Enable 3D terrain
      map.setTerrain({
        source: 'terrain',
        exaggeration: ${terrainExaggeration},
      });

      // Sky/fog to blend horizon instead of white tiles
      // setSky may not be available in all MapLibre versions — cosmetic only, safe to skip
      try {
        if (isSatellite) {
          map.setSky({
            'sky-color': '#1a3a5c',
            'horizon-color': '#2a4a6c',
            'fog-color': '#1a3050',
            'fog-ground-blend': 0.5,
            'horizon-fog-blend': 0.8,
            'sky-horizon-blend': 0.5,
            'atmosphere-blend': 0.8,
          });
        } else if (${isDark}) {
          map.setSky({
            'sky-color': '#0a0a14',
            'horizon-color': '#151520',
            'fog-color': '#0a0a14',
            'fog-ground-blend': 0.5,
            'horizon-fog-blend': 0.8,
            'sky-horizon-blend': 0.5,
            'atmosphere-blend': 0.8,
          });
        } else {
          map.setSky({
            'sky-color': '#88C6FC',
            'horizon-color': '#B0C8DC',
            'fog-color': '#D8E4EE',
            'fog-ground-blend': 0.5,
            'horizon-fog-blend': 0.8,
            'sky-horizon-blend': 0.5,
            'atmosphere-blend': 0.8,
          });
        }
      } catch(e) {
        console.log('[3D] setSky unavailable (ok): ' + e.message);
      }

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
          tolerance: 0,
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
            'line-width': 8,
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
            'line-width': 5,
          },
        });

        // Start/end circle markers
        var startPt = coordinates[0];
        var endPt = coordinates[coordinates.length - 1];
        map.addSource('start-end-markers', {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: [
              { type: 'Feature', properties: { type: 'start' }, geometry: { type: 'Point', coordinates: startPt } },
              { type: 'Feature', properties: { type: 'end' }, geometry: { type: 'Point', coordinates: endPt } },
            ],
          },
        });
        // White border ring
        map.addLayer({
          id: 'start-end-border',
          type: 'circle',
          source: 'start-end-markers',
          paint: {
            'circle-radius': 7,
            'circle-color': '#FFFFFF',
          },
        });
        // Colored fill (green start, red end)
        map.addLayer({
          id: 'start-end-fill',
          type: 'circle',
          source: 'start-end-markers',
          paint: {
            'circle-radius': 5,
            'circle-color': ['case', ['==', ['get', 'type'], 'start'], 'rgba(34,197,94,0.75)', 'rgba(239,68,68,0.75)'],
          },
        });
      }

      // Terrain-first ready detection — only wait for DEM terrain and route sources,
      // not ALL tiles. At 60° pitch, horizon vector/label tiles are deprioritized and
      // may never fully load, causing the old areTilesLoaded() to always hit the timeout.
      var mapReadySent = false;
      function sendMapReady() {
        if (mapReadySent) return;
        mapReadySent = true;
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'mapReady' }));
        }
      }

      var terrainReady = false;
      var routeReady = coordinates.length === 0;

      map.on('sourcedata', function(e) {
        if (mapReadySent) return;
        if (e.sourceId === 'terrain' && e.isSourceLoaded) terrainReady = true;
        if (e.sourceId === 'route' && e.isSourceLoaded) routeReady = true;
        if (terrainReady && routeReady) {
          requestAnimationFrame(function() { sendMapReady(); });
        }
      });

      // Fallback for when sourcedata doesn't fire (e.g. cached tiles)
      map.once('idle', function() {
        if (!mapReadySent) {
          requestAnimationFrame(function() { sendMapReady(); });
        }
      });

      map.resize(); // Ensure MapLibre knows full WebView dimensions

      // Hard fallback — reduced from 8s to 4s since we no longer wait for all tiles.
      // Terrain + route sources load much faster than full vector tile sets.
      setTimeout(function() {
        if (!mapReadySent) {
          console.log('[3D] Hard timeout — sending mapReady after 4s');
          sendMapReady();
        }
      }, 4000);

      // Preload adjacent DEM zoom levels after map settles — populates Cache API
      // so zoom in/out has instant terrain. Uses cached-terrain:// protocol.
      map.once('idle', function() {
        setTimeout(function() {
          var z = Math.floor(map.getZoom());
          var b = map.getBounds();
          function lng2tile(lng, zoom) { return Math.floor((lng + 180) / 360 * Math.pow(2, zoom)); }
          function lat2tile(lat, zoom) { return Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom)); }
          [z - 1, z + 1].filter(function(v) { return v >= 0 && v <= 15; }).forEach(function(zl) {
            var xMin = lng2tile(b.getWest(), zl);
            var xMax = lng2tile(b.getEast(), zl);
            var yMin = lat2tile(b.getNorth(), zl);
            var yMax = lat2tile(b.getSouth(), zl);
            for (var x = xMin; x <= xMax; x++) {
              for (var y = yMin; y <= yMax; y++) {
                new Image().src = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/' + zl + '/' + x + '/' + y + '.png';
              }
            }
          });
        }, 1000);
      });
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
      // NOTE: mapStyle is NOT a dependency - style changes use setStyle() via injectJavaScript
      // to avoid full WebView reload (which re-downloads all tiles)
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
          androidLayerType="hardware"
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
