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
import * as FileSystem from 'expo-file-system/legacy';
import { colors, darkColors } from '@/theme';
import { getBoundsFromPoints } from '@/lib';
import { HEATMAP_TILES_DIR } from '@/hooks/maps/useHeatmapTiles';
import type { MapStyleType } from './mapStyles';
import {
  getCombinedSatelliteStyle3D,
  SATELLITE_SOURCES,
  rewriteSatelliteUrls,
  rewriteVectorUrls,
  TERRAIN_3D_CONFIG,
} from './mapStyles';
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
  /** Highlight marker position as [lng, lat] (from chart scrubbing) */
  highlightCoordinate?: [number, number] | null;
  /** Whether to show the heatmap raster overlay */
  showHeatmap?: boolean;
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
  /** Called when user taps on the map (for section creation) */
  onMapClick?: (coordinate: [number, number]) => void;
  /** Called when user taps on a section line feature */
  onSectionClick?: (sectionId: string) => void;
  /** GeoJSON for section creation line (start to end highlight) */
  sectionCreationGeoJSON?: GeoJSON.FeatureCollection | GeoJSON.Feature | null;
  /** Section creation start marker [lng, lat] */
  sectionCreationStart?: [number, number] | null;
  /** Section creation end marker [lng, lat] */
  sectionCreationEnd?: [number, number] | null;
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
      highlightCoordinate,
      showHeatmap = false,
      onMapReady,
      onBearingChange,
      onCameraStateChange,
      initialCamera,
      onMapClick,
      onSectionClick,
      sectionCreationGeoJSON,
      sectionCreationStart,
      sectionCreationEnd,
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

    // Store callback refs to avoid stale closures in message handler
    const onMapClickRef = useRef(onMapClick);
    const onSectionClickRef = useRef(onSectionClick);
    onMapClickRef.current = onMapClick;
    onSectionClickRef.current = onSectionClick;

    // Store initial center/zoom/camera in refs - only used on first render
    // This prevents HTML regeneration when parent updates these values
    const initialCenterRef = useRef(initialCenter);
    const initialZoomRef = useRef(initialZoom);
    const initialCameraRef = useRef(initialCamera);
    // Track mapStyle in ref — style changes are applied via setStyle() injection
    const mapStyleRef = useRef(mapStyle);
    const initialMapStyleRef = useRef(mapStyle);
    // Track pending style change timeout for cleanup
    const styleChangeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Cleanup on unmount — stop WebView loading and mark map as not ready
    useEffect(() => {
      return () => {
        mapReadyRef.current = false;
        webViewRef.current?.stopLoading();
        if (styleChangeTimerRef.current) {
          clearTimeout(styleChangeTimerRef.current);
          styleChangeTimerRef.current = null;
        }
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
          if (data.type === 'console') {
            console.log('[3D]', data.message);
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
          } else if (
            data.type === 'mapClick' &&
            Array.isArray(data.coordinate) &&
            data.coordinate.length === 2
          ) {
            onMapClickRef.current?.(data.coordinate as [number, number]);
          } else if (data.type === 'sectionClick' && typeof data.sectionId === 'string') {
            onSectionClickRef.current?.(data.sectionId);
          } else if (data.type === 'heatmapTileRequest' && data.requestId && data.tilePath) {
            // Heatmap tile request from WebView — read PNG from filesystem, return as base64
            const fullPath = `${HEATMAP_TILES_DIR}${data.tilePath}`;
            FileSystem.getInfoAsync(fullPath)
              .then((info) => {
                if (info.exists && info.size > 0) {
                  return FileSystem.readAsStringAsync(fullPath, {
                    encoding: FileSystem.EncodingType.Base64,
                  });
                }
                return null;
              })
              .then((base64) => {
                if (!webViewRef.current) return;
                if (base64) {
                  webViewRef.current.injectJavaScript(`
                  (function() {
                    var req = window._heatmapRequests && window._heatmapRequests['${data.requestId}'];
                    if (req) {
                      var binary = atob('${base64}');
                      var blob = new Blob([binary], { type: 'image/png' });
                      var url = URL.createObjectURL(blob);
                      var img = new Image();
                      img.onload = function() {
                        URL.revokeObjectURL(url);
                        req.resolve({ data: img });
                        delete window._heatmapRequests['${data.requestId}'];
                      };
                      img.onerror = function() {
                        URL.revokeObjectURL(url);
                        req.reject(new Error('heatmap image decode failed'));
                        delete window._heatmapRequests['${data.requestId}'];
                      };
                      img.src = url;
                    }
                  })();
                  true;
                `);
                } else {
                  // Tile not found
                  webViewRef.current.injectJavaScript(`
                  (function() {
                    var req = window._heatmapRequests && window._heatmapRequests['${data.requestId}'];
                    if (req) {
                      req.reject(new Error('not found'));
                      delete window._heatmapRequests['${data.requestId}'];
                    }
                  })();
                  true;
                `);
                }
              })
              .catch(() => {
                // Read error
                webViewRef.current?.injectJavaScript(`
                (function() {
                  var req = window._heatmapRequests && window._heatmapRequests['${data.requestId}'];
                  if (req) {
                    req.reject(new Error('read error'));
                    delete window._heatmapRequests['${data.requestId}'];
                  }
                })();
                true;
              `);
              });
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

      // Satellite: rewrite to cached protocol for tile caching.
      // Dark: keep original TileJSON URL — let MapLibre fetch tiles natively
      // (cached-vector:// rewrite was causing blank features after setStyle).
      // Light: fetch URL-based style in JS.
      const styleConfig = isSatellite
        ? JSON.stringify(rewriteSatelliteUrls(getCombinedSatelliteStyle3D()))
        : mapStyle === 'dark'
          ? JSON.stringify(DARK_MATTER_STYLE)
          : `null`;

      const lightStyleUrl = 'https://tiles.openfreemap.org/styles/liberty';

      // Serialize shared terrain config for injection
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

      webViewRef.current.injectJavaScript(`
        (function() {
          if (!window.map) return;

          var isSatellite = ${isSatellite};
          var isDark = ${isDark};
          var coords = window._routeCoords || [];
          var routeColor = '${routeColor}';
          var terrainSource = ${terrainSourceJSON};
          var skyConfig = ${skyConfigJSON};
          var hillshadePaint = ${hillshadePaintJSON};
          var hillshadeInsertCandidates = ${JSON.stringify(TERRAIN_3D_CONFIG.hillshadeInsertBeforeCandidates)};

          // Build style: either JSON object or fetch URL-based style
          function applyNewStyle(styleObj) {
            styleObj.sources['terrain'] = terrainSource;
            styleObj.terrain = { source: 'terrain', exaggeration: ${terrainExaggeration} };
            styleObj.sky = skyConfig;

            // Insert hillshade before the first transportation/building layer found
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
                  paint: { 'line-color': '#FFFFFF', 'line-width': 5, 'line-opacity': 0.8 } },
                { id: 'route-line', type: 'line', source: 'route',
                  layout: { 'line-join': 'round', 'line-cap': 'round' },
                  paint: { 'line-color': routeColor, 'line-width': 3 } },
                { id: 'start-end-border', type: 'circle', source: 'start-end-markers',
                  paint: { 'circle-radius': 7, 'circle-color': '#FFFFFF' } },
                { id: 'start-end-fill', type: 'circle', source: 'start-end-markers',
                  paint: { 'circle-radius': 5,
                    'circle-color': ['case', ['==', ['get', 'type'], 'start'], 'rgba(34,197,94,0.75)', 'rgba(239,68,68,0.75)'] } }
              );
            }

            window.map.setStyle(styleObj);
            console.log('[3D] Style changed via setStyle()');

            // Re-add heatmap raster overlay (setStyle clears all sources/layers)
            window.map.once('style.load', function() {
              if (!window.map.getSource('heatmap-tiles')) {
                var isLight = '${mapStyle}' === 'light';
                window.map.addSource('heatmap-tiles', {
                  type: 'raster',
                  tiles: ['heatmap-file://{z}/{x}/{y}.png'],
                  tileSize: 256,
                  minzoom: 5,
                  maxzoom: 17
                });
                window.map.addLayer({
                  id: 'heatmap-layer',
                  type: 'raster',
                  source: 'heatmap-tiles',
                  paint: {
                    'raster-opacity': ${showHeatmap} ? (isLight ? 0.82 : 0.72) : 0,
                    'raster-contrast': isLight ? 0.25 : 0,
                    'raster-brightness-max': isLight ? 0.7 : 1,
                    'raster-saturation': isLight ? 0.4 : 0,
                    'raster-fade-duration': 0,
                    'raster-resampling': 'linear'
                  }
                }, 'route-outline');
              }
            });
          }

          var styleJSON = ${styleConfig};
          if (styleJSON) {
            applyNewStyle(styleJSON);
          } else {
            // Light style is URL-based — fetch and apply without rewriting vector URLs.
            // Let MapLibre handle TileJSON resolution natively for reliable tile loading.
            fetch('${lightStyleUrl}')
              .then(function(r) { return r.json(); })
              .then(function(s) {
                applyNewStyle(s);
              })
              .catch(function(e) { console.warn('[3D] Failed to fetch light style:', e); });
          }
        })();
        true;
      `);

      // After style change, re-apply GeoJSON overlay layers once the new style settles.
      // Cancel any pending timer from a previous style change to prevent stale calls.
      if (styleChangeTimerRef.current) {
        clearTimeout(styleChangeTimerRef.current);
      }
      styleChangeTimerRef.current = setTimeout(() => {
        styleChangeTimerRef.current = null;
        updateLayers();
      }, 500);
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

    // Update highlight marker position in WebView (from chart scrubbing)
    // Throttled to ~16ms to avoid flooding the JS bridge at 60fps
    const lastHighlightRef = useRef<number>(0);
    useEffect(() => {
      if (!webViewRef.current || !mapReadyRef.current) return;
      const now = Date.now();
      if (now - lastHighlightRef.current < 16) return;
      lastHighlightRef.current = now;

      if (highlightCoordinate) {
        webViewRef.current.injectJavaScript(`
          if (window.map && window.map.getSource('highlight-point')) {
            window.map.getSource('highlight-point').setData({ type: 'Point', coordinates: [${highlightCoordinate[0]}, ${highlightCoordinate[1]}] });
            window.map.setLayoutProperty('highlight-border', 'visibility', 'visible');
            window.map.setLayoutProperty('highlight-fill', 'visibility', 'visible');
          }
          true;
        `);
      } else {
        webViewRef.current.injectJavaScript(`
          if (window.map && window.map.getSource('highlight-point')) {
            window.map.setLayoutProperty('highlight-border', 'visibility', 'none');
            window.map.setLayoutProperty('highlight-fill', 'visibility', 'none');
          }
          true;
        `);
      }
    }, [highlightCoordinate]);

    // Update section creation layers dynamically (line + start/end markers)
    useEffect(() => {
      if (!webViewRef.current || !mapReadyRef.current) return;

      const hasLine =
        sectionCreationGeoJSON &&
        ((sectionCreationGeoJSON as GeoJSON.Feature).type === 'Feature' ||
          ((sectionCreationGeoJSON as GeoJSON.FeatureCollection).features?.length ?? 0) > 0);

      const lineJSON = hasLine ? JSON.stringify(sectionCreationGeoJSON) : 'null';
      const hasStart = !!sectionCreationStart;
      const hasEnd = !!sectionCreationEnd;

      // Build markers FeatureCollection
      const markerFeatures: GeoJSON.Feature[] = [];
      if (hasStart && sectionCreationStart) {
        markerFeatures.push({
          type: 'Feature',
          properties: { type: 'start' },
          geometry: { type: 'Point', coordinates: sectionCreationStart },
        });
      }
      if (hasEnd && sectionCreationEnd) {
        markerFeatures.push({
          type: 'Feature',
          properties: { type: 'end' },
          geometry: { type: 'Point', coordinates: sectionCreationEnd },
        });
      }
      const markersJSON =
        markerFeatures.length > 0
          ? JSON.stringify({ type: 'FeatureCollection', features: markerFeatures })
          : 'null';

      webViewRef.current.injectJavaScript(`
        (function() {
          if (!window.map) return;
          // Update section creation line
          var lineData = ${lineJSON};
          var lineSource = window.map.getSource('section-creation-line');
          if (lineSource) {
            if (lineData) {
              lineSource.setData(lineData);
              window.map.setLayoutProperty('section-creation-line-outline', 'visibility', 'visible');
              window.map.setLayoutProperty('section-creation-line-fill', 'visibility', 'visible');
            } else {
              window.map.setLayoutProperty('section-creation-line-outline', 'visibility', 'none');
              window.map.setLayoutProperty('section-creation-line-fill', 'visibility', 'none');
            }
          }
          // Update section creation markers
          var markersData = ${markersJSON};
          var markerSource = window.map.getSource('section-creation-markers');
          if (markerSource) {
            if (markersData) {
              markerSource.setData(markersData);
              window.map.setLayoutProperty('section-creation-marker-border', 'visibility', 'visible');
              window.map.setLayoutProperty('section-creation-marker-fill', 'visibility', 'visible');
              window.map.setLayoutProperty('section-creation-marker-icon', 'visibility', 'visible');
            } else {
              window.map.setLayoutProperty('section-creation-marker-border', 'visibility', 'none');
              window.map.setLayoutProperty('section-creation-marker-fill', 'visibility', 'none');
              window.map.setLayoutProperty('section-creation-marker-icon', 'visibility', 'none');
            }
          }
        })();
        true;
      `);
    }, [sectionCreationGeoJSON, sectionCreationStart, sectionCreationEnd]);

    // Toggle heatmap visibility dynamically (without regenerating HTML)
    useEffect(() => {
      if (!webViewRef.current || !mapReadyRef.current) return;
      const isLight = mapStyleRef.current === 'light';
      const opacity = showHeatmap ? (isLight ? 0.82 : 0.72) : 0;
      webViewRef.current.injectJavaScript(`
        if (window.map && window.map.getLayer('heatmap-layer')) {
          window.map.setPaintProperty('heatmap-layer', 'raster-opacity', ${opacity});
        }
        true;
      `);
    }, [showHeatmap]);

    // Reload WebView on crash (iOS content process termination / Android render process gone)
    const handleWebViewCrash = useCallback(() => {
      mapReadyRef.current = false;
      webViewRef.current?.reload();
    }, []);

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

      // Serialize shared terrain config for injection into initial HTML
      const initTerrainSourceJSON = JSON.stringify(TERRAIN_3D_CONFIG.source);
      const initSkyConfigJSON = JSON.stringify(
        isSatellite
          ? TERRAIN_3D_CONFIG.sky.satellite
          : isDark
            ? TERRAIN_3D_CONFIG.sky.dark
            : TERRAIN_3D_CONFIG.sky.light
      );
      const initHillshadePaintJSON = JSON.stringify(
        isDark ? TERRAIN_3D_CONFIG.hillshadePaint.dark : TERRAIN_3D_CONFIG.hillshadePaint.light
      );

      // For satellite, we use combined style with all regional sources layered
      // For dark, we use the bundled Dark Matter style with OpenFreeMap tiles
      // Rewrite tile URLs to use cached protocols for offline/performance
      const styleConfig = isSatellite
        ? JSON.stringify(rewriteSatelliteUrls(getCombinedSatelliteStyle3D()))
        : initStyle === 'dark'
          ? JSON.stringify(rewriteVectorUrls(DARK_MATTER_STYLE))
          : `null`; // light uses URL-based style — fetched and rewritten in JS init

      return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>3D Map</title>
  <script src="https://unpkg.com/maplibre-gl@5.19.0/dist/maplibre-gl.js"></script>
  <link href="https://unpkg.com/maplibre-gl@5.19.0/dist/maplibre-gl.css" rel="stylesheet" />
  <style>
    body { margin: 0; padding: 0; overflow: hidden; }
    #map { width: 100vw; height: 100vh; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    // Bridge console logging to React Native for debugging
    window._rn_log = function(msg) {
      try {
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'console', message: String(msg)
          }));
        }
      } catch(e) {}
    };

    const coordinates = ${coordsJSON};
    window._routeCoords = coordinates;
    const bounds = ${boundsJSON};
    const center = ${centerJSON};
    const savedZoom = ${zoomValue};
    const savedBearing = ${bearingValue};
    const savedPitch = ${pitchValue};
    const isSatellite = ${isSatellite};
    const _terrainSource = ${initTerrainSourceJSON};
    const _skyConfig = ${initSkyConfigJSON};
    const _hillshadePaint = ${initHillshadePaintJSON};
    const _hillshadeInsertCandidates = ${JSON.stringify(TERRAIN_3D_CONFIG.hillshadeInsertBeforeCandidates)};

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

    // Cache terrain DEM tiles via Cache API — persists across WebView recreations
    // because baseUrl is https://veloq.fit/ (stable HTTPS origin).
    // MapLibre v5.19.0 uses promise-based addProtocol.
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

    // Cache satellite tiles via Cache API
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

    // Cache vector tiles (protocol buffers) via Cache API
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

    // Heatmap tile protocol — reads PNG tiles from device filesystem via RN bridge
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
        // Timeout after 10s to prevent stuck requests
        setTimeout(function() {
          if (window._heatmapRequests[requestId]) {
            delete window._heatmapRequests[requestId];
            reject(new Error('heatmap tile timeout'));
          }
        }, 10000);
      });
    });

    // Rewrite vector source URLs in a fetched style JSON
    function rewriteVectorSources(s) {
      if (s.sources && s.sources.openmaptiles && s.sources.openmaptiles.url === 'https://tiles.openfreemap.org/planet') {
        delete s.sources.openmaptiles.url;
        s.sources.openmaptiles.tiles = ['cached-vector://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf'];
        s.sources.openmaptiles.maxzoom = 14;
      }
      return s;
    }

    // Create map with appropriate style
    // Use saved camera state if available, otherwise use bounds or center/zoom
    function buildMapOptions(style) {
      var opts = {
        container: 'map',
        style: style,
        pitch: savedPitch,
        maxPitch: 85,
        bearing: savedBearing,
        attributionControl: false,
        antialias: true,
        pixelRatio: ${devicePixelRatio},
      };
      if (bounds && !${!!savedCamera}) {
        opts.bounds = [bounds.sw, bounds.ne];
        opts.fitBoundsOptions = { padding: 50 };
      } else if (center) {
        opts.center = center;
        opts.zoom = savedZoom;
      } else {
        opts.center = [0, 0];
        opts.zoom = 2;
      }
      return opts;
    }

    // Satellite/dark use inline style JSON; light uses URL directly.
    // Light mode URL-based init lets MapLibre handle TileJSON resolution
    // and vector tile loading natively — more reliable than fetch+rewrite.
    try {
    var styleJSON = ${styleConfig};
    if (styleJSON) {
      window._rn_log('creating map with inline style (satellite/dark)');
      window.map = new maplibregl.Map(buildMapOptions(styleJSON));
    } else {
      window._rn_log('creating map with light style URL');
      window.map = new maplibregl.Map(buildMapOptions('https://tiles.openfreemap.org/styles/liberty'));
    }

    var map = window.map;

    // Surface map-level errors, but suppress expected tile 404s from regional sources
    map.on('error', function(e) {
      var msg = e.error ? e.error.message || String(e.error) : e.message || '';
      if (msg.indexOf('HTTP 4') === 0) return;
      window._rn_log('map error: ' + msg);
    });

    // Track camera changes and save state for restoration
    function saveCameraState() {
      if (window.ReactNativeWebView) {
        var c = map.getCenter();
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'cameraState',
          camera: {
            center: [c.lng, c.lat],
            zoom: map.getZoom(),
            bearing: map.getBearing(),
            pitch: map.getPitch()
          }
        }));
      }
    }

    // Track bearing changes and notify React Native
    map.on('rotate', function() {
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

    map.on('load', function() {
      window._rn_log('map load event fired');

      // Add terrain source from shared config
      map.addSource('terrain', _terrainSource);

      // Enable 3D terrain
      map.setTerrain({
        source: 'terrain',
        exaggeration: ${terrainExaggeration},
      });
      window._rn_log('terrain set, exaggeration=${terrainExaggeration}');

      // Sky/fog from shared config — setSky may not be available, cosmetic only
      try {
        map.setSky(_skyConfig);
        window._rn_log('sky set');
      } catch(e) {
        window._rn_log('setSky unavailable (ok): ' + e.message);
      }

      // Add hillshade before the first transportation/building layer found
      if (!isSatellite) {
        var _hillshadeBefore = undefined;
        for (var ci = 0; ci < _hillshadeInsertCandidates.length; ci++) {
          if (map.getLayer(_hillshadeInsertCandidates[ci])) {
            _hillshadeBefore = _hillshadeInsertCandidates[ci];
            break;
          }
        }
        window._rn_log('hillshade insert before: ' + (_hillshadeBefore || 'end'));
        map.addLayer({
          id: 'hillshading',
          type: 'hillshade',
          source: 'terrain',
          layout: { visibility: 'visible' },
          paint: _hillshadePaint,
        }, _hillshadeBefore);
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
            'line-width': 5,
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
            'line-width': 3,
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

      // Create highlight marker as map layers (not DOM marker — immune to terrain occlusion)
      map.addSource('highlight-point', {
        type: 'geojson',
        data: { type: 'Point', coordinates: [0, 0] },
      });
      map.addLayer({
        id: 'highlight-border',
        type: 'circle',
        source: 'highlight-point',
        paint: { 'circle-radius': 7, 'circle-color': '#FFFFFF' },
        layout: { visibility: 'none' },
      });
      map.addLayer({
        id: 'highlight-fill',
        type: 'circle',
        source: 'highlight-point',
        paint: { 'circle-radius': 5, 'circle-color': '#00BCD4' },
        layout: { visibility: 'none' },
      });

      // Section creation layers — used for interactive section creation in 3D mode
      // Line showing the selected section portion
      map.addSource('section-creation-line', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'section-creation-line-outline',
        type: 'line',
        source: 'section-creation-line',
        layout: { 'line-join': 'round', 'line-cap': 'round', visibility: 'none' },
        paint: { 'line-color': '#FFFFFF', 'line-width': 8, 'line-opacity': 0.6 },
      });
      map.addLayer({
        id: 'section-creation-line-fill',
        type: 'line',
        source: 'section-creation-line',
        layout: { 'line-join': 'round', 'line-cap': 'round', visibility: 'none' },
        paint: { 'line-color': '#22C55E', 'line-width': 6, 'line-opacity': 1 },
      });

      // Section creation start/end markers
      map.addSource('section-creation-markers', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'section-creation-marker-border',
        type: 'circle',
        source: 'section-creation-markers',
        paint: { 'circle-radius': 10, 'circle-color': '#FFFFFF' },
        layout: { visibility: 'none' },
      });
      map.addLayer({
        id: 'section-creation-marker-fill',
        type: 'circle',
        source: 'section-creation-markers',
        paint: {
          'circle-radius': 8,
          'circle-color': ['case',
            ['==', ['get', 'type'], 'start'], 'rgba(34,197,94,0.9)',
            'rgba(239,68,68,0.9)'],
        },
        layout: { visibility: 'none' },
      });
      map.addLayer({
        id: 'section-creation-marker-icon',
        type: 'symbol',
        source: 'section-creation-markers',
        layout: {
          'text-field': ['case', ['==', ['get', 'type'], 'start'], '▶', '■'],
          'text-size': 10,
          'text-allow-overlap': true,
          'text-ignore-placement': true,
          visibility: 'none',
        },
        paint: { 'text-color': '#FFFFFF' },
      });

      // Click handler — posts map coordinates back to React Native
      map.on('click', function(e) {
        // Check if the click hit a section line feature first
        var sectionFeatures = map.queryRenderedFeatures(e.point, { layers: ['sections-layer'] });
        if (sectionFeatures && sectionFeatures.length > 0) {
          var props = sectionFeatures[0].properties;
          var sectionId = props && (props.sectionId || props.id);
          if (sectionId && window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'sectionClick',
              sectionId: String(sectionId)
            }));
            return;
          }
        }
        // Otherwise, send a generic map click with coordinates
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'mapClick',
            coordinate: [e.lngLat.lng, e.lngLat.lat]
          }));
        }
      });

      // Heatmap raster overlay (reads tiles from device filesystem via heatmap-file:// protocol)
      var showHeatmap = ${showHeatmap};
      var isLightMap = '${mapStyle}' === 'light';
      map.addSource('heatmap-tiles', {
        type: 'raster',
        tiles: ['heatmap-file://{z}/{x}/{y}.png'],
        tileSize: 256,
        minzoom: 5,
        maxzoom: 17
      });
      map.addLayer({
        id: 'heatmap-layer',
        type: 'raster',
        source: 'heatmap-tiles',
        paint: {
          'raster-opacity': showHeatmap ? (isLightMap ? 0.82 : 0.72) : 0,
          'raster-contrast': isLightMap ? 0.25 : 0,
          'raster-brightness-max': isLightMap ? 0.7 : 1,
          'raster-saturation': isLightMap ? 0.4 : 0,
          'raster-fade-duration': 0,
          'raster-resampling': 'linear'
        }
      }, 'route-outline');

      // Terrain-first ready detection — only wait for DEM terrain and route sources,
      // not ALL tiles. At 60° pitch, horizon vector/label tiles are deprioritized and
      // may never fully load, causing the old areTilesLoaded() to always hit the timeout.
      var mapReadySent = false;
      function sendMapReady() {
        if (mapReadySent) return;
        mapReadySent = true;
        window._rn_log('sending mapReady — terrain:' + terrainHits + '/' + terrainMisses + ' sat:' + satHits + '/' + satMisses + ' vec:' + vecHits + '/' + vecMisses);
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
          window._rn_log('hard timeout — sending mapReady after 4s');
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

    } catch(e) {
      window._rn_log('SCRIPT ERROR: ' + e.message + ' at ' + (e.stack || ''));
    }
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
      showHeatmap,
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
          onContentProcessDidTerminate={handleWebViewCrash}
          onRenderProcessGone={handleWebViewCrash}
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
