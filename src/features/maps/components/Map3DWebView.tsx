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

import { veloqWebViewNativeConfig } from '@/features/maps/lib/veloqWebView';

import { colors, darkColors, mapLayerColors } from '@/theme';
import { getBoundsFromPoints } from '@/shared/geo/polyline';
import { useMap3DBridge } from '@/features/maps/hooks/useMap3DBridge';
import { planHighlightSend } from '@/features/maps/lib/highlightThrottle';
import {
  buildMap3DHtml,
  buildSetRouteScript,
  buildUpdateLayersScript,
  LAYER_KEYS,
  resolveStyleExpression,
  TERRAIN_STYLE_OPTIONS,
} from '@/features/maps/lib/htmlBuilders';
import type { LayerKey, UpdateLayersParams } from '@/features/maps/lib/htmlBuilders';
import { buildReleaseMapScript } from '@/features/maps/lib/htmlBuilders/shared';
import { diffSpec, type SentSpec } from '@/features/maps/lib/mapSurfacePatch';
import { registerReleasableSurface } from '@/features/maps/lib/mapSurfaceRegistry';
import { useLiveTileCacheBudget } from '@/features/maps/hooks/useLiveTileCacheBudget';
import { useLiveTileCacheClear } from '@/features/maps/hooks/useLiveTileCacheClear';
import type { MapStyleType } from './mapStyles';
import { TERRAIN_3D_CONFIG } from './mapStyles';
import { jsLiteral } from '@/features/maps/lib/webViewLiterals';

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
  /** GeoJSON for section boundary ticks (perpendicular start/end markers) */
  sectionBoundariesGeoJSON?: GeoJSON.FeatureCollection;
  /** GeoJSON for section marker circles (numbered/PR labels) */
  sectionMarkersGeoJSON?: GeoJSON.FeatureCollection;
  /** GeoJSON for activity point markers - colored circles per activity, used by
   *  the global map in 3D so the view matches the 2D markers/clusters paradigm
   *  instead of drawing every full activity polyline. Features must carry
   *  `properties.color` (hex string) and may carry `properties.size`. */
  pointMarkersGeoJSON?: GeoJSON.FeatureCollection;
  /** Highlight marker position as [lng, lat] (from chart scrubbing) */
  highlightCoordinate?: [number, number] | null;
  /** Section ID currently highlighted (from list row press). Dims other portions. */
  highlightedSectionId?: string | null;
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
  /** Called when the page or the WebView failed and no map will appear */
  onMapFailed?: (reason: string) => void;
  /** Called when the page drew, but had no DEM tiles, so the terrain is flat */
  onTerrainUnavailable?: (reason: string) => void;
  /** Called when bearing changes (for compass sync) */
  onBearingChange?: (bearing: number) => void;
  /** Called when the full camera state updates (center, zoom, bearing, pitch) */
  onCameraStateChange?: (camera: {
    center: [number, number];
    zoom: number;
    bearing: number;
    pitch: number;
  }) => void;
  /** Saved camera override - if provided, skips fitBounds and uses this on first load */
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
  /** Called when user taps on an activity point marker (global map only) */
  onActivityClick?: (activityId: string) => void;
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
      sectionBoundariesGeoJSON,
      sectionMarkersGeoJSON,
      pointMarkersGeoJSON,
      highlightCoordinate,
      highlightedSectionId,
      showHeatmap = false,
      onMapReady,
      onMapFailed,
      onTerrainUnavailable,
      onBearingChange,
      onCameraStateChange,
      initialCamera,
      onMapClick,
      onSectionClick,
      onActivityClick,
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
    const pointMarkersGeoJSONRef = useRef(pointMarkersGeoJSON);
    const sectionBoundariesGeoJSONRef = useRef(sectionBoundariesGeoJSON);
    const highlightedSectionIdRef = useRef(highlightedSectionId);

    // Store callback refs to avoid stale closures in message handler
    const onMapClickRef = useRef(onMapClick);
    const onSectionClickRef = useRef(onSectionClick);
    const onActivityClickRef = useRef(onActivityClick);
    onMapClickRef.current = onMapClick;
    onSectionClickRef.current = onSectionClick;
    onActivityClickRef.current = onActivityClick;

    // Store initial center/zoom/camera in refs - only used on first render
    // This prevents HTML regeneration when parent updates these values
    const initialCenterRef = useRef(initialCenter);
    const initialZoomRef = useRef(initialZoom);
    const initialCameraRef = useRef(initialCamera);
    // Track mapStyle in ref - style changes are applied via setStyle() injection
    const mapStyleRef = useRef(mapStyle);
    // Read by the page memo and the style injector, neither of which may depend
    // on it: the page memo would regenerate the HTML and reload the whole
    // WebView for a toggle the live injection below already handles, which
    // reboots maplibre and refetches every DEM and hillshade tile.
    const showHeatmapRef = useRef(showHeatmap);
    showHeatmapRef.current = showHeatmap;
    const initialMapStyleRef = useRef(mapStyle);

    // Cleanup on unmount - stop WebView loading and mark map as not ready
    useEffect(() => {
      return () => {
        mapReadyRef.current = false;
        webViewRef.current?.stopLoading();
      };
    }, []);

    // The ceiling is baked into the HTML when the page is built, so a change
    // made while this map is open has to be sent in.
    const injectScript = useCallback((script: string) => {
      webViewRef.current?.injectJavaScript(script);
    }, []);
    useLiveTileCacheBudget(injectScript);
    useLiveTileCacheClear(injectScript);

    // Keep refs in sync with props
    useEffect(() => {
      routesGeoJSONRef.current = routesGeoJSON;
      sectionsGeoJSONRef.current = sectionsGeoJSON;
      tracesGeoJSONRef.current = tracesGeoJSON;
      sectionMarkersGeoJSONRef.current = sectionMarkersGeoJSON;
      pointMarkersGeoJSONRef.current = pointMarkersGeoJSON;
      sectionBoundariesGeoJSONRef.current = sectionBoundariesGeoJSON;
      highlightedSectionIdRef.current = highlightedSectionId;
    }, [
      routesGeoJSON,
      sectionsGeoJSON,
      tracesGeoJSON,
      sectionMarkersGeoJSON,
      pointMarkersGeoJSON,
      sectionBoundariesGeoJSON,
      highlightedSectionId,
    ]);

    // What the page holds, so an update ships only the collections that moved.
    // Cleared wherever the page stops being ready, since a reloaded or
    // restyled page holds nothing and has to be given everything again.
    const sentLayersRef = useRef<Partial<Record<LayerKey, SentSpec<unknown>>>>({});
    const forgetLayers = useCallback(() => {
      sentLayersRef.current = {};
    }, []);

    // Update GeoJSON layers dynamically without reloading WebView
    // Reads from refs to avoid stale closure issues
    // Uses retry mechanism to handle style loading race conditions
    const updateLayers = useCallback(() => {
      if (!webViewRef.current || !mapReadyRef.current) return;

      const collections: UpdateLayersParams = {
        routesGeoJSON: routesGeoJSONRef.current,
        sectionsGeoJSON: sectionsGeoJSONRef.current,
        tracesGeoJSON: tracesGeoJSONRef.current,
        sectionMarkersGeoJSON: sectionMarkersGeoJSONRef.current,
        pointMarkersGeoJSON: pointMarkersGeoJSONRef.current,
        sectionBoundariesGeoJSON: sectionBoundariesGeoJSONRef.current,
        highlightedSectionId: highlightedSectionIdRef.current,
      };

      // Only what moved. A highlight change used to re-inject every section
      // polyline and every point marker into the page, because the script
      // carried all seven collections whichever one changed.
      const patch: UpdateLayersParams = {};
      let changed = false;
      for (const key of LAYER_KEYS) {
        const value = collections[key];
        const diff = diffSpec(sentLayersRef.current[key], value);
        sentLayersRef.current[key] = diff.sent;
        if (!diff.changed) continue;
        // The key is present once it is in the patch, which is what the page
        // reads as "this one changed".
        Object.assign(patch, { [key]: value });
        changed = true;
      }
      if (!changed) return;

      webViewRef.current.injectJavaScript(buildUpdateLayersScript(patch));
    }, []);

    // Handle messages from WebView - dispatch via the shared 3D bridge.
    const handleMessage = useMap3DBridge({
      webViewRef,
      mapReadyRef,
      savedCameraRef,
      onMapClickRef,
      onSectionClickRef,
      onActivityClickRef,
      updateLayers,
      onMapReady,
      onMapFailed,
      onTerrainUnavailable,
      onBearingChange,
      onCameraStateChange,
    });

    // Update layers when GeoJSON props change (without reloading WebView)
    useEffect(() => {
      if (mapReadyRef.current) {
        updateLayers();
      }
    }, [
      routesGeoJSON,
      sectionsGeoJSON,
      tracesGeoJSON,
      sectionMarkersGeoJSON,
      pointMarkersGeoJSON,
      sectionBoundariesGeoJSON,
      highlightedSectionId,
      updateLayers,
    ]);

    // Apply style changes via setStyle() injection - avoids full WebView reload.
    // Builds a complete style object with terrain, sky, hillshade, and route layers,
    // then applies atomically via map.setStyle() (same pattern as TerrainSnapshotWebView).
    useEffect(() => {
      // Skip when style hasn't actually changed from what's rendered
      if (mapStyle === mapStyleRef.current) return;
      mapStyleRef.current = mapStyle;

      if (!webViewRef.current || !mapReadyRef.current) return;

      const isSatellite = mapStyle === 'satellite';
      const isDark = mapStyle === 'dark' || mapStyle === 'satellite';

      // Vector tiles stay on their TileJSON URL here: rewriting them to
      // cached-vector:// after a setStyle left features blank until the cache
      // warmed, which is only tolerable on a cold page load.
      const { styleJSON: styleConfig, url: lightStyleUrl } = resolveStyleExpression(
        mapStyle,
        TERRAIN_STYLE_OPTIONS
      );

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
          var routeColor = ${jsLiteral(routeColor)};
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
                  paint: { 'line-color': ${jsLiteral(mapLayerColors.casing)}, 'line-width': 5, 'line-opacity': 0.8 } },
                { id: 'route-line', type: 'line', source: 'route',
                  layout: { 'line-join': 'round', 'line-cap': 'round' },
                  paint: { 'line-color': routeColor, 'line-width': 3 } },
                { id: 'start-end-border', type: 'circle', source: 'start-end-markers',
                  paint: { 'circle-radius': 7, 'circle-color': ${jsLiteral(mapLayerColors.casing)} } },
                { id: 'start-end-fill', type: 'circle', source: 'start-end-markers',
                  paint: { 'circle-radius': 5,
                    'circle-color': ['case', ['==', ['get', 'type'], 'start'], 'rgba(34,197,94,0.75)', 'rgba(239,68,68,0.75)'] } }
              );
            }

            window.map.setStyle(styleObj);
            console.log('[3D] Style changed via setStyle()');

            // Re-add heatmap raster overlay (setStyle clears all sources/layers).
            // Probe for 'route-outline' before inserting under it - it's only
            // present in activity-detail mode (when route coordinates exist).
            window.map.once('style.load', function() {
              if (!window.map.getSource('heatmap-tiles')) {
                var isLight = ${jsLiteral(mapStyle)} === 'light';
                window.map.addSource('heatmap-tiles', {
                  type: 'raster',
                  tiles: ['heatmap-file://{z}/{x}/{y}.png'],
                  tileSize: 256,
                  minzoom: 5,
                  maxzoom: 17
                });
                var heatmapBeforeId = window.map.getLayer('route-outline') ? 'route-outline' : undefined;
                window.map.addLayer({
                  id: 'heatmap-layer',
                  type: 'raster',
                  source: 'heatmap-tiles',
                  paint: {
                    'raster-opacity': ${showHeatmapRef.current} ? (isLight ? 0.82 : 0.72) : 0,
                    'raster-contrast': isLight ? 0.25 : 0,
                    'raster-brightness-max': isLight ? 0.7 : 1,
                    'raster-saturation': isLight ? 0.4 : 0,
                    'raster-fade-duration': 0,
                    'raster-resampling': 'linear'
                  }
                }, heatmapBeforeId);
              }
            });
          }

          var styleJSON = ${styleConfig};
          if (styleJSON) {
            applyNewStyle(styleJSON);
          } else {
            // Light style is URL-based - fetch and apply without rewriting vector URLs.
            // Let MapLibre handle TileJSON resolution natively for reliable tile loading.
            fetch(${jsLiteral(lightStyleUrl)})
              .then(function(r) { return r.json(); })
              .then(function(s) {
                applyNewStyle(s);
              })
              .catch(function(e) { console.warn('[3D] Failed to fetch light style:', e); });
          }
        })();
        true;
      `);

      // A setStyle wipes every source, so the page holds nothing to patch.
      forgetLayers();
      // After style change, re-apply GeoJSON overlay layers once the new style settles
      setTimeout(() => updateLayers(), 500);
      // `showHeatmap` is read from its ref above: this effect bails when the
      // style has not changed, and a toggle goes through the injection below.
    }, [mapStyle, routeColor, terrainExaggeration, forgetLayers, updateLayers]);

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

    // Update highlight marker position in WebView (from chart scrubbing).
    // Throttled so the bridge is not flooded at 60fps, with a trailing call so
    // the last position of a scrub still lands.
    const lastHighlightRef = useRef<number | null>(null);
    const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const sendHighlight = useCallback((coordinate: [number, number] | null | undefined) => {
      if (!webViewRef.current || !mapReadyRef.current) return;
      lastHighlightRef.current = Date.now();

      if (coordinate) {
        webViewRef.current.injectJavaScript(`
          if (window.map && window.map.getSource('highlight-point')) {
            window.map.getSource('highlight-point').setData({ type: 'Point', coordinates: [${coordinate[0]}, ${coordinate[1]}] });
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
    }, []);

    useEffect(() => {
      const cancel = () => {
        if (highlightTimerRef.current === null) return;
        clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = null;
      };
      cancel();

      if (webViewRef.current && mapReadyRef.current) {
        const plan = planHighlightSend(lastHighlightRef.current, Date.now(), highlightCoordinate);
        if (plan.kind === 'send') {
          sendHighlight(highlightCoordinate);
        } else {
          highlightTimerRef.current = setTimeout(() => {
            highlightTimerRef.current = null;
            sendHighlight(highlightCoordinate);
          }, plan.afterMs);
        }
      }

      return cancel;
    }, [highlightCoordinate, sendHighlight]);

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
            // Update section creation line - re-create source/layers after setStyle wipes them
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
                paint: { 'line-color': ${jsLiteral(mapLayerColors.casing)}, 'line-width': 8, 'line-opacity': 0.6 },
              });
              window.map.addLayer({
                id: 'section-creation-line-fill', type: 'line', source: 'section-creation-line',
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: { 'line-color': ${jsLiteral(mapLayerColors.sectionCreation)}, 'line-width': 6, 'line-opacity': 1 },
              });
            }
            // Update section creation markers - re-create if missing
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
                paint: { 'circle-radius': 10, 'circle-color': ${jsLiteral(mapLayerColors.casing)} },
              });
              window.map.addLayer({
                id: 'section-creation-marker-fill', type: 'circle', source: 'section-creation-markers',
                paint: { 'circle-radius': 8, 'circle-color': ['case', ['==', ['get', 'type'], 'start'], 'rgba(34,197,94,0.9)', 'rgba(239,68,68,0.9)'] },
              });
              window.map.addLayer({
                id: 'section-creation-marker-icon', type: 'symbol', source: 'section-creation-markers',
                layout: { 'text-field': ['case', ['==', ['get', 'type'], 'start'], '\\u25B6', '\\u25A0'], 'text-size': 10, 'text-allow-overlap': true, 'text-ignore-placement': true },
                paint: { 'text-color': ${jsLiteral(mapLayerColors.casing)} },
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

    // The page reports its own failures, but it can only do that once it has
    // loaded. A main frame that never arrives has to be reported from here.
    const handleWebViewError = useCallback(() => {
      mapReadyRef.current = false;
      forgetLayers();
      onMapFailed?.('webview load error');
    }, [forgetLayers, onMapFailed]);

    // Reload WebView on crash (iOS content process termination / Android render process gone)
    const handleWebViewCrash = useCallback(() => {
      mapReadyRef.current = false;
      forgetLayers();
      webViewRef.current?.reload();
    }, [forgetLayers]);

    // A released page holds no map until the reload, so the layer updates are
    // silenced the same way a crash silences them.
    useEffect(
      () =>
        registerReleasableSurface({
          release: () => {
            mapReadyRef.current = false;
            forgetLayers();
            webViewRef.current?.injectJavaScript(buildReleaseMapScript());
          },
          rebuild: handleWebViewCrash,
        }),
      [forgetLayers, handleWebViewCrash]
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

    // Only the route the page was built with. A later one is injected, so the
    // page is not rebuilt to draw it.
    const builtCoordinatesRef = useRef(coordinates);
    const builtBoundsRef = useRef(bounds);
    builtBoundsRef.current = bounds;

    // Swap the drawn route on the page that is already up.
    useEffect(() => {
      if (coordinates === builtCoordinatesRef.current) return;
      builtCoordinatesRef.current = coordinates;
      if (!webViewRef.current || !mapReadyRef.current) return;
      webViewRef.current.injectJavaScript(buildSetRouteScript(coordinates, bounds));
    }, [coordinates, bounds]);

    // Use initial center/zoom when no coordinates provided

    // Generate the HTML for the WebView
    // IMPORTANT: Only depends on style-related props, NOT GeoJSON data
    // GeoJSON layers are updated dynamically via injectJavaScript
    const html = useMemo(() => {
      // Reset map ready state when HTML regenerates
      mapReadyRef.current = false;
      // A rebuilt page holds nothing, so the next update sends everything.
      sentLayersRef.current = {};

      // Use saved camera position if available (from previous style change),
      // then fall back to initialCamera override (from parent), then to initial props.
      const savedCamera = savedCameraRef.current ?? initialCameraRef.current;
      const centerOverride = savedCamera ? savedCamera.center : (initialCenterRef.current ?? null);
      const zoom = savedCamera ? savedCamera.zoom : (initialZoomRef.current ?? 12);
      const bearing = savedCamera ? savedCamera.bearing : 0;
      const pitch = savedCamera ? savedCamera.pitch : initialPitch;

      return buildMap3DHtml({
        coordinates: builtCoordinatesRef.current,
        bounds: builtBoundsRef.current,
        centerOverride,
        zoom,
        bearing,
        pitch,
        hasSavedCamera: !!savedCamera,
        terrainExaggeration,
        // Use initial style ref - subsequent style changes are handled via
        // setStyle() injection without regenerating HTML.
        initStyle: initialMapStyleRef.current,
        // mapStyle (current prop) is intentionally captured via closure here,
        // so the heatmap `isLightMap` calc reflects the style in effect at the
        // time the memo re-ran. It's not a memo dependency because style changes
        // go through setStyle() injection, not HTML regeneration.
        mapStyle,
        routeColor,
        showHeatmap: showHeatmapRef.current,
        devicePixelRatio: Math.min(PixelRatio.get(), 2), // Cap at 2x for 3D terrain
      });
      // `mapStyle` is read above and deliberately not a dependency: it is
      // applied by setStyle() injection, and listing it here would regenerate
      // the whole HTML on every style change. `coordinates` and `bounds` come
      // from refs for the same reason: a rebuilt page reboots maplibre and
      // refetches every DEM and hillshade tile, so a new selection goes in
      // through `buildSetRouteScript` instead.
      // `showHeatmap` comes from its ref for the same reason `mapStyle` does:
      // the toggle is injected onto the layer that is already there, and
      // listing it here reloaded the page and dropped the camera with it.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [routeColor, initialPitch, terrainExaggeration]);

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
          nativeConfig={veloqWebViewNativeConfig}
          onMessage={handleMessage}
          onError={handleWebViewError}
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
