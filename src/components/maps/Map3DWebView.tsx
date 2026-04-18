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
import { useWebViewBridge } from '@/hooks/maps/useWebViewBridge';
import type { WebViewBridgeHandlers, WebViewBridgeMessage } from '@/hooks/maps/useWebViewBridge';
import { buildMap3DHtml } from '@/lib/maps/htmlBuilders';
import type { MapStyleType } from './mapStyles';
import { getCombinedSatelliteStyle3D, rewriteSatelliteUrls, TERRAIN_3D_CONFIG } from './mapStyles';
import { DARK_MATTER_STYLE } from './darkMatterStyle';

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
  /** GeoJSON for section marker circles (numbered/PR labels) */
  sectionMarkersGeoJSON?: GeoJSON.FeatureCollection;
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
      sectionMarkersGeoJSON,
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
    const sectionMarkersGeoJSONRef = useRef(sectionMarkersGeoJSON);

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
      sectionMarkersGeoJSONRef.current = sectionMarkersGeoJSON;
    }, [routesGeoJSON, sectionsGeoJSON, tracesGeoJSON, sectionMarkersGeoJSON]);

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
      const sectionMarkersJSON = sectionMarkersGeoJSONRef.current
        ? JSON.stringify(sectionMarkersGeoJSONRef.current)
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
            const sectionMarkersData = ${sectionMarkersJSON};

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

            // Update sections layer — match 2D palette: cyan (#00BCD4) default, gold (#D4AF37) for PRs
            addLayerWithOutline('sections-source', 'sections-layer', sectionsData,
              ['case', ['==', ['get', 'isPR'], true], '#D4AF37', '#00BCD4'], 5, 0.9);

            // Update traces layer (activity GPS tracks) - use color from GeoJSON
            addLayerWithOutline('traces-source', 'traces-layer', tracesData, ['get', 'color'], 2, 0.7);

            // Update section markers (numbered/PR circles matching 2D parity)
            var markerSourceExists = !!window.map.getSource('section-markers-source');
            var hasMarkers = sectionMarkersData && sectionMarkersData.features && sectionMarkersData.features.length > 0;

            try {
              if (markerSourceExists) {
                if (hasMarkers) {
                  window.map.getSource('section-markers-source').setData(sectionMarkersData);
                  window.map.setLayoutProperty('section-marker-circle-3d', 'visibility', 'visible');
                  window.map.setLayoutProperty('section-marker-border-3d', 'visibility', 'visible');
                  window.map.setLayoutProperty('section-marker-text-3d', 'visibility', 'visible');
                } else {
                  window.map.setLayoutProperty('section-marker-circle-3d', 'visibility', 'none');
                  window.map.setLayoutProperty('section-marker-border-3d', 'visibility', 'none');
                  window.map.setLayoutProperty('section-marker-text-3d', 'visibility', 'none');
                }
              } else if (hasMarkers) {
                window.map.addSource('section-markers-source', { type: 'geojson', data: sectionMarkersData });
                window.map.addLayer({
                  id: 'section-marker-border-3d',
                  type: 'circle',
                  source: 'section-markers-source',
                  paint: {
                    'circle-radius': ['case', ['get', 'isPR'], 16, 14],
                    'circle-color': '#FFFFFF',
                  },
                });
                window.map.addLayer({
                  id: 'section-marker-circle-3d',
                  type: 'circle',
                  source: 'section-markers-source',
                  paint: {
                    'circle-radius': ['case', ['get', 'isPR'], 14, 12],
                    'circle-color': ['case', ['get', 'isPR'], '#D4AF37', '#00BCD4'],
                    'circle-stroke-width': ['case', ['get', 'isPR'], 2.5, 2],
                    'circle-stroke-color': '#FFFFFF',
                  },
                });
                window.map.addLayer({
                  id: 'section-marker-text-3d',
                  type: 'symbol',
                  source: 'section-markers-source',
                  layout: {
                    'text-field': ['get', 'label'],
                    'text-size': 10,
                    'text-anchor': 'center',
                    'text-allow-overlap': true,
                    'text-ignore-placement': true,
                  },
                  paint: { 'text-color': '#FFFFFF' },
                });
              }
            } catch (e) {
              console.warn('Section marker layer error:', e);
            }

            console.log('[3D] Layers updated - routes:', routesData?.features?.length || 0,
                        'sections:', sectionsData?.features?.length || 0,
                        'traces:', tracesData?.features?.length || 0,
                        'markers:', sectionMarkersData?.features?.length || 0);
          }

          addOrUpdateLayers();
        })();
        true;
      `);
    }, []);

    // Handle messages from WebView — dispatch via shared bridge
    // Each handler keeps its previous body; only the outer parse/dispatch moved
    // into `useWebViewBridge`.
    const bridgeHandlers = useMemo<WebViewBridgeHandlers>(
      () => ({
        console: (data: WebViewBridgeMessage) => {
          console.log('[3D]', data.message);
        },
        mapReady: () => {
          mapReadyRef.current = true;
          onMapReady?.();
          // Update layers after map is ready - small delay ensures style is fully settled
          setTimeout(() => updateLayers(), 100);
        },
        bearingChange: (data: WebViewBridgeMessage) => {
          if (typeof data.bearing === 'number') {
            onBearingChange?.(data.bearing);
          }
        },
        cameraState: (data: WebViewBridgeMessage) => {
          if (!data.camera) return;
          const camera = data.camera as {
            center: [number, number];
            zoom: number;
            bearing: number;
            pitch: number;
          };
          // Save camera state for restoration
          savedCameraRef.current = camera;
          onCameraStateChange?.(camera);
        },
        mapClick: (data: WebViewBridgeMessage) => {
          if (Array.isArray(data.coordinate) && data.coordinate.length === 2) {
            onMapClickRef.current?.(data.coordinate as [number, number]);
          }
        },
        sectionClick: (data: WebViewBridgeMessage) => {
          if (typeof data.sectionId === 'string') {
            onSectionClickRef.current?.(data.sectionId);
          }
        },
        heatmapTileRequest: (data: WebViewBridgeMessage) => {
          if (!data.requestId || !data.tilePath) return;
          const requestId = data.requestId as string;
          const tilePath = data.tilePath as string;
          // Heatmap tile request from WebView — read PNG from filesystem, return as base64
          const fullPath = `${HEATMAP_TILES_DIR}${tilePath}`;
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
                    var req = window._heatmapRequests && window._heatmapRequests['${requestId}'];
                    if (req) {
                      var binary = atob('${base64}');
                      var blob = new Blob([binary], { type: 'image/png' });
                      var url = URL.createObjectURL(blob);
                      var img = new Image();
                      img.onload = function() {
                        URL.revokeObjectURL(url);
                        req.resolve({ data: img });
                        delete window._heatmapRequests['${requestId}'];
                      };
                      img.onerror = function() {
                        URL.revokeObjectURL(url);
                        req.reject(new Error('heatmap image decode failed'));
                        delete window._heatmapRequests['${requestId}'];
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
                    var req = window._heatmapRequests && window._heatmapRequests['${requestId}'];
                    if (req) {
                      req.reject(new Error('not found'));
                      delete window._heatmapRequests['${requestId}'];
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
                  var req = window._heatmapRequests && window._heatmapRequests['${requestId}'];
                  if (req) {
                    req.reject(new Error('read error'));
                    delete window._heatmapRequests['${requestId}'];
                  }
                })();
                true;
              `);
            });
        },
      }),
      [onMapReady, onBearingChange, onCameraStateChange, updateLayers]
    );
    const handleMessage = useWebViewBridge(bridgeHandlers);

    // Update layers when GeoJSON props change (without reloading WebView)
    useEffect(() => {
      if (mapReadyRef.current) {
        updateLayers();
      }
    }, [routesGeoJSON, sectionsGeoJSON, tracesGeoJSON, sectionMarkersGeoJSON, updateLayers]);

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
          try {
            // Update section creation line — re-create source/layers after setStyle wipes them
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
            } else if (lineData) {
              window.map.addSource('section-creation-line', { type: 'geojson', data: lineData });
              window.map.addLayer({
                id: 'section-creation-line-outline', type: 'line', source: 'section-creation-line',
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: { 'line-color': '#FFFFFF', 'line-width': 8, 'line-opacity': 0.6 },
              });
              window.map.addLayer({
                id: 'section-creation-line-fill', type: 'line', source: 'section-creation-line',
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: { 'line-color': '#22C55E', 'line-width': 6, 'line-opacity': 1 },
              });
            }
            // Update section creation markers — re-create if missing
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
            } else if (markersData) {
              window.map.addSource('section-creation-markers', { type: 'geojson', data: markersData });
              window.map.addLayer({
                id: 'section-creation-marker-border', type: 'circle', source: 'section-creation-markers',
                paint: { 'circle-radius': 10, 'circle-color': '#FFFFFF' },
              });
              window.map.addLayer({
                id: 'section-creation-marker-fill', type: 'circle', source: 'section-creation-markers',
                paint: { 'circle-radius': 8, 'circle-color': ['case', ['==', ['get', 'type'], 'start'], 'rgba(34,197,94,0.9)', 'rgba(239,68,68,0.9)'] },
              });
              window.map.addLayer({
                id: 'section-creation-marker-icon', type: 'symbol', source: 'section-creation-markers',
                layout: { 'text-field': ['case', ['==', ['get', 'type'], 'start'], '\\u25B6', '\\u25A0'], 'text-size': 10, 'text-allow-overlap': true, 'text-ignore-placement': true },
                paint: { 'text-color': '#FFFFFF' },
              });
            }
          } catch (e) { console.warn('[3D] Section creation layer error:', e); }
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

      // Use saved camera position if available (from previous style change),
      // then fall back to initialCamera override (from parent), then to initial props.
      const savedCamera = savedCameraRef.current ?? initialCameraRef.current;
      const centerOverride = savedCamera ? savedCamera.center : (initialCenterRef.current ?? null);
      const zoom = savedCamera ? savedCamera.zoom : (initialZoomRef.current ?? 12);
      const bearing = savedCamera ? savedCamera.bearing : 0;
      const pitch = savedCamera ? savedCamera.pitch : initialPitch;

      return buildMap3DHtml({
        coordinates,
        bounds,
        centerOverride,
        zoom,
        bearing,
        pitch,
        hasSavedCamera: !!savedCamera,
        terrainExaggeration,
        // Use initial style ref — subsequent style changes are handled via
        // setStyle() injection without regenerating HTML.
        initStyle: initialMapStyleRef.current,
        // mapStyle (current prop) is intentionally captured via closure here,
        // so the heatmap `isLightMap` calc reflects the style in effect at the
        // time the memo re-ran. It's not a memo dependency because style changes
        // go through setStyle() injection, not HTML regeneration.
        mapStyle,
        routeColor,
        showHeatmap,
        devicePixelRatio: Math.min(PixelRatio.get(), 2), // Cap at 2x for 3D terrain
      });
    }, [coordinates, bounds, routeColor, initialPitch, terrainExaggeration, showHeatmap]);

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
