import React, {
  useMemo,
  useRef,
  useImperativeHandle,
  forwardRef,
  useEffect,
  useCallback,
  useState,
} from 'react';
import { sectionCreation3DLayers } from '@/features/maps/lib/sectionCreationPaint';
import { View, StyleSheet, PixelRatio } from 'react-native';
import { WebView } from 'react-native-webview';

import { veloqWebViewNativeConfig } from '@/features/maps/lib/veloqWebView';
import { mapPageBaseUrl } from '@/features/maps/lib/tileTransport';

import { colors, darkColors, mapLayerColors } from '@/theme';
import { getBoundsFromPoints } from '@/shared/geo/polyline';
import { useMap3DBridge } from '@/features/maps/hooks/useMap3DBridge';
import { planHighlightSend } from '@/features/maps/lib/highlightThrottle';
import { heatmapRasterPaint } from '@/features/maps/lib/heatmapPaint';
import { HEATMAP_SOURCE_MINZOOM, heatmapTileTemplate } from '@/features/maps/lib/heatmapTiles';
import { useHeatmapGeneration } from '@/features/maps/lib/heatmapGeneration';
import {
  buildMap3DHtml,
  buildFitBoundsScript,
  buildSetCameraScript,
  buildSetRouteGradientScript,
  buildSetRouteScript,
  buildStyleOverlayScript,
  buildUpdateLayersScript,
  LAYER_KEYS,
  resolveStyleExpression,
} from '@/features/maps/lib/htmlBuilders';
import type {
  LayerKey,
  MapCameraSpec,
  MapPadding,
  UpdateLayersParams,
} from '@/features/maps/lib/htmlBuilders';
import type { LngLatBounds } from '@/features/maps/lib/coordinates';
import { buildReleaseMapScript } from '@/features/maps/lib/htmlBuilders/shared';
import { diffSpec, type SentSpec } from '@/features/maps/lib/mapSurfacePatch';
import { registerReleasableSurface } from '@/features/maps/lib/mapSurfaceRegistry';
import type { MapStyleType } from './mapStyles';
import { HILLSHADE_INSERT_INDEX_SCRIPT, TERRAIN_3D_CONFIG, terrain3DSource } from './mapStyles';
import { jsLiteral, jsLiteralList } from '@/features/maps/lib/webViewLiterals';
import { BUNDLED_TEXT_FONT } from '@/features/maps/lib/bundledGlyphs';

// Stable empty array to prevent unnecessary re-renders when coordinates prop is undefined
const EMPTY_COORDS: [number, number][] = [];

interface Map3DWebViewProps {
  /** Route coordinates as [lng, lat] pairs (optional - if not provided, just shows terrain) */
  coordinates?: [number, number][] | undefined;
  /** Map theme */
  mapStyle: MapStyleType;
  /** Route line color */
  routeColor?: string | undefined;
  /** `line-gradient` expression for the route line, or null for the flat colour. */
  routeGradient?: object | null | undefined;
  /** Initial camera pitch in degrees (0-85) */
  initialPitch?: number | undefined;
  /** Terrain exaggeration factor */
  terrainExaggeration?: number | undefined;
  /** Initial center as [lng, lat] - used when no coordinates provided */
  initialCenter?: [number, number] | undefined;
  /** Initial zoom level - used when no coordinates provided */
  initialZoom?: number | undefined;
  /** GeoJSON for routes layer */
  routesGeoJSON?: GeoJSON.FeatureCollection | undefined;
  /** GeoJSON for sections layer */
  sectionsGeoJSON?: GeoJSON.FeatureCollection | undefined;
  /** GeoJSON for traces layer */
  tracesGeoJSON?: GeoJSON.FeatureCollection | undefined;
  /** GeoJSON for section boundary ticks (perpendicular start/end markers) */
  sectionBoundariesGeoJSON?: GeoJSON.FeatureCollection | undefined;
  /** Trim overlay for a section being edited: the kept line, the extension line
   *  and the trimmed end points, tagged by `properties.kind`. Empty restores the
   *  full line. */
  sectionTrimGeoJSON?: GeoJSON.FeatureCollection | undefined;
  /** GeoJSON for the selected activity or lap, drawn over the section traces */
  highlightedTraceGeoJSON?: GeoJSON.FeatureCollection | undefined;
  /** GeoJSON for section marker circles (numbered/PR labels) */
  sectionMarkersGeoJSON?: GeoJSON.FeatureCollection | undefined;
  /** GeoJSON for activity point markers - colored circles per activity, used by
   *  the global map in 3D so the view matches the 2D markers/clusters paradigm
   *  instead of drawing every full activity polyline. Features must carry
   *  `properties.color` (hex string) and may carry `properties.size`. */
  pointMarkersGeoJSON?: GeoJSON.FeatureCollection | undefined;
  /** Legs from fanned-out stacked starts back to their shared spot */
  spiderLinesGeoJSON?: GeoJSON.FeatureCollection | undefined;
  /** Highlight marker position as [lng, lat] (from chart scrubbing) */
  highlightCoordinate?: [number, number] | null | undefined;
  /** Section ID currently highlighted (from list row press). Dims other portions. */
  highlightedSectionId?: string | null | undefined;
  /** Whether to show the heatmap raster overlay */
  showHeatmap?: boolean | undefined;
}

export interface Map3DWebViewRef {
  /** Reset bearing to north and pitch to look straight down */
  resetOrientation: () => void;
  /** Fit a bounding box. `duration` of 0 jumps. */
  fitBounds: (bounds: LngLatBounds, padding?: MapPadding, duration?: number) => void;
  /** Move to a centre and zoom. `duration` of 0 jumps. */
  setCamera: (camera: MapCameraSpec, duration?: number) => void;
}

interface Map3DWebViewPropsInternal extends Map3DWebViewProps {
  /** Called when the map has finished loading */
  onMapReady?: (() => void) | undefined;
  /** Called when the page or the WebView failed and no map will appear */
  onMapFailed?: ((reason: string) => void) | undefined;
  /** Called when the page drew, but had no DEM tiles, so the terrain is flat */
  onTerrainUnavailable?: ((reason: string) => void) | undefined;
  /** Called when bearing changes (for compass sync) */
  onBearingChange?: ((bearing: number) => void) | undefined;
  /** Called when the full camera state updates (center, zoom, bearing, pitch) */
  onCameraStateChange?: (
    camera: {
      center: [number, number];
      zoom: number;
      bearing: number;
      pitch: number;
    },
    gesture: boolean
  ) => void;
  /** Saved camera override - if provided, skips fitBounds and uses this on first load */
  initialCamera?:
    | {
        center: [number, number];
        zoom: number;
        bearing: number;
        pitch: number;
      }
    | null
    | undefined;
  /** Called when user taps on the map (for section creation) */
  onMapClick?: ((coordinate: [number, number]) => void) | undefined;
  /** Called when user taps on a section line feature */
  onSectionClick?: ((sectionId: string) => void) | undefined;
  /** Called when user taps on an activity point marker (global map only) */
  onActivityClick?: ((activityId: string, hits: GeoJSON.Feature[]) => void) | undefined;
  /** GeoJSON for section creation line (start to end highlight) */
  sectionCreationGeoJSON?: GeoJSON.FeatureCollection | GeoJSON.Feature | null | undefined;
  /** Section creation start marker [lng, lat] */
  sectionCreationStart?: [number, number] | null | undefined;
  /** Section creation end marker [lng, lat] */
  sectionCreationEnd?: [number, number] | null | undefined;
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
      routeGradient = null,
      initialPitch = 60,
      terrainExaggeration = 1.5,
      initialCenter,
      initialZoom = 12,
      routesGeoJSON,
      sectionsGeoJSON,
      tracesGeoJSON,
      sectionMarkersGeoJSON,
      pointMarkersGeoJSON,
      spiderLinesGeoJSON,
      sectionBoundariesGeoJSON,
      sectionTrimGeoJSON,
      highlightedTraceGeoJSON,
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
    const spiderLinesGeoJSONRef = useRef(spiderLinesGeoJSON);
    const sectionBoundariesGeoJSONRef = useRef(sectionBoundariesGeoJSON);
    const sectionTrimGeoJSONRef = useRef(sectionTrimGeoJSON);
    const highlightedTraceGeoJSONRef = useRef(highlightedTraceGeoJSON);
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
    // `appliedStyleRef` is what the page shows, `pageStyleRef` what its html was
    // built with, which is what any reload comes back up in.
    const mapStyleRef = useRef(mapStyle);
    const appliedStyleRef = useRef(mapStyle);
    const pageStyleRef = useRef(mapStyle);
    // Read by the page memo and the style injector, neither of which may depend
    // on it: the page memo would regenerate the HTML and reload the whole
    // WebView for a toggle the live injection below already handles, which
    // reboots maplibre and refetches every DEM and hillshade tile.
    const showHeatmapRef = useRef(showHeatmap);
    showHeatmapRef.current = showHeatmap;
    // Read by the page memo, the style injector and the route swap. The colour
    // changes on the same tap as the route, so keying the page on it rebuilt
    // the page for every selection.
    const routeColorRef = useRef(routeColor);
    routeColorRef.current = routeColor;
    const routeGradientRef = useRef(routeGradient);
    routeGradientRef.current = routeGradient;
    // The gradient the page holds. A page that was rebuilt or restyled holds none.
    const drawnGradientRef = useRef<object | null>(null);
    const coordinatesRef = useRef(coordinates);
    coordinatesRef.current = coordinates;
    const boundsRef = useRef<ReturnType<typeof getBoundsFromPoints> | null>(null);
    // What the page was built with, and what it shows now. A page that stops
    // being ready goes back to its built route, since a reload restores that.
    const pageRouteRef = useRef<{ coordinates: [number, number][]; color: string }>({
      coordinates,
      color: routeColor,
    });
    const drawnRouteRef = useRef(pageRouteRef.current);
    // Read by the page memo and the style injector for the same reason: a
    // finished pass is injected onto the source that is already there.
    const heatmapGeneration = useHeatmapGeneration();
    const heatmapGenerationRef = useRef(heatmapGeneration);
    heatmapGenerationRef.current = heatmapGeneration;
    const sentHeatmapGenerationRef = useRef(heatmapGeneration);
    // Counts finished style swaps, so the effects that feed the page's fixed
    // sources send their current state again once a swap has settled.
    const [styleEpoch, setStyleEpoch] = useState(0);

    // Cleanup on unmount - stop WebView loading and mark map as not ready.
    // The WebView is captured on mount: React detaches the ref before this
    // cleanup runs, so reading it here finds null and the page keeps loading.
    useEffect(() => {
      const webView = webViewRef.current;
      return () => {
        mapReadyRef.current = false;
        webView?.stopLoading();
      };
    }, []);

    // Keep refs in sync with props
    useEffect(() => {
      routesGeoJSONRef.current = routesGeoJSON;
      sectionsGeoJSONRef.current = sectionsGeoJSON;
      tracesGeoJSONRef.current = tracesGeoJSON;
      sectionMarkersGeoJSONRef.current = sectionMarkersGeoJSON;
      pointMarkersGeoJSONRef.current = pointMarkersGeoJSON;
      spiderLinesGeoJSONRef.current = spiderLinesGeoJSON;
      sectionBoundariesGeoJSONRef.current = sectionBoundariesGeoJSON;
      sectionTrimGeoJSONRef.current = sectionTrimGeoJSON;
      highlightedTraceGeoJSONRef.current = highlightedTraceGeoJSON;
      highlightedSectionIdRef.current = highlightedSectionId;
    }, [
      routesGeoJSON,
      sectionsGeoJSON,
      tracesGeoJSON,
      sectionMarkersGeoJSON,
      pointMarkersGeoJSON,
      spiderLinesGeoJSON,
      sectionBoundariesGeoJSON,
      sectionTrimGeoJSON,
      highlightedTraceGeoJSON,
      highlightedSectionId,
    ]);

    // What the page holds, so an update ships only the collections that moved.
    // Cleared wherever the page stops being ready, since a reloaded or
    // restyled page holds nothing and has to be given everything again.
    const sentLayersRef = useRef<Partial<Record<LayerKey, SentSpec<unknown>>>>({});
    const forgetLayers = useCallback(() => {
      sentLayersRef.current = {};
      drawnRouteRef.current = pageRouteRef.current;
      drawnGradientRef.current = null;
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
        spiderLinesGeoJSON: spiderLinesGeoJSONRef.current,
        sectionBoundariesGeoJSON: sectionBoundariesGeoJSONRef.current,
        sectionTrimGeoJSON: sectionTrimGeoJSONRef.current,
        highlightedTraceGeoJSON: highlightedTraceGeoJSONRef.current,
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

    // Bring the page's route and colour to the current ones. Called when either
    // changes and when a page reports ready, so a route that arrived while the
    // page was booting or a reload that restored an older one is not lost.
    const syncRoute = useCallback(() => {
      if (!webViewRef.current || !mapReadyRef.current) return;
      const drawn = drawnRouteRef.current;
      const coords = coordinatesRef.current;
      const color = routeColorRef.current;
      const gradient = routeGradientRef.current;
      if (drawnGradientRef.current !== gradient) {
        drawnGradientRef.current = gradient;
        webViewRef.current.injectJavaScript(buildSetRouteGradientScript(gradient));
      }
      if (drawn.coordinates === coords && drawn.color === color) return;
      drawnRouteRef.current = { coordinates: coords, color };
      webViewRef.current.injectJavaScript(buildSetRouteScript(coords, boundsRef.current, color));
    }, []);

    // Handle messages from WebView - dispatch via the shared 3D bridge.

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
      spiderLinesGeoJSON,
      sectionBoundariesGeoJSON,
      sectionTrimGeoJSON,
      highlightedTraceGeoJSON,
      highlightedSectionId,
      updateLayers,
    ]);

    // Apply style changes via setStyle() injection - avoids full WebView reload.
    // Builds a complete style object with terrain, sky, hillshade, and route layers,
    // then applies atomically via map.setStyle() (same pattern as TerrainSnapshotWebView).
    const syncStyle = useCallback(() => {
      const mapStyle = mapStyleRef.current;
      // Skip when style hasn't actually changed from what's rendered. A change
      // made before the page is ready is kept back for its ready message.
      if (!webViewRef.current || !mapReadyRef.current) return;
      if (mapStyle === appliedStyleRef.current) return;
      appliedStyleRef.current = mapStyle;

      const isSatellite = mapStyle === 'satellite';
      const isDark = mapStyle === 'dark' || mapStyle === 'satellite';

      const { styleJSON: styleConfig } = resolveStyleExpression(mapStyle);

      // Serialize shared terrain config for injection
      const terrainSourceJSON = JSON.stringify(terrain3DSource());
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

          ${buildStyleOverlayScript()}

          var isSatellite = ${isSatellite};
          var isDark = ${isDark};
          var coords = window._routeCoords || [];
          var routeColor = ${jsLiteral(routeColorRef.current)};
          var terrainSource = ${terrainSourceJSON};
          var skyConfig = ${skyConfigJSON};
          var hillshadePaint = ${hillshadePaintJSON};
          ${HILLSHADE_INSERT_INDEX_SCRIPT}
          var hillshadeInsertCandidates = ${JSON.stringify(TERRAIN_3D_CONFIG.hillshadeInsertBeforeCandidates)};

          // Build style: either JSON object or fetch URL-based style
          function applyNewStyle(styleObj) {
            styleObj.sources['terrain'] = terrainSource;
            styleObj.terrain = { source: 'terrain', exaggeration: ${terrainExaggeration} };
            styleObj.sky = skyConfig;

            // Insert hillshade before the first transportation/building layer found
            if (!isSatellite) {
              var hillshadeIdx = hillshadeInsertIndex(styleObj.layers, hillshadeInsertCandidates);
              styleObj.layers.splice(hillshadeIdx, 0, {
                id: 'hillshading',
                type: 'hillshade',
                source: 'terrain',
                layout: { visibility: 'visible' },
                paint: hillshadePaint,
              });
            }

            // The route, its markers and the scrub marker are always part of
            // the style, empty and hidden when there is nothing to draw, so a
            // later setRoute or scrub finds its source.
            var overlays = veloqOverlays(coords, routeColor);
            for (var sid in overlays.sources) styleObj.sources[sid] = overlays.sources[sid];
            for (var oi = 0; oi < overlays.layers.length; oi++) styleObj.layers.push(overlays.layers[oi]);

            window.map.setStyle(styleObj);
            console.log('[3D] Style changed via setStyle()');

            // Re-add heatmap raster overlay (setStyle clears all sources/layers).
            // Probe for 'route-outline' before inserting under it - it's only
            // present in activity-detail mode (when route coordinates exist).
            window.map.once('style.load', function() {
              if (!window.map.getSource('heatmap-tiles')) {
                window.map.addSource('heatmap-tiles', {
                  type: 'raster',
                  tiles: [${jsLiteral(heatmapTileTemplate(heatmapGenerationRef.current))}],
                  tileSize: 256,
                  minzoom: ${HEATMAP_SOURCE_MINZOOM},
                  maxzoom: 17
                });
                var heatmapBeforeId = window.map.getLayer('route-outline') ? 'route-outline' : undefined;
                window.map.addLayer({
                  id: 'heatmap-layer',
                  type: 'raster',
                  source: 'heatmap-tiles',
                  layout: { visibility: ${showHeatmapRef.current} ? 'visible' : 'none' },
                  paint: ${JSON.stringify(heatmapRasterPaint(mapStyle))}
                }, heatmapBeforeId);
              }
            });
          }

          var styleJSON = ${styleConfig};
          applyNewStyle(styleJSON);
        })();
        true;
      `);

      // A setStyle wipes every source, so the page holds nothing to patch.
      forgetLayers();
      // After style change, re-apply GeoJSON overlay layers once the new style settles
      // The scrub marker and section creation state ride the same timer, since
      // the page holds only the fixed sources until they are sent again.
      setTimeout(() => {
        updateLayers();
        setStyleEpoch((n) => n + 1);
      }, 500);
      // `showHeatmap` is read from its ref above: this effect bails when the
      // style has not changed, and a toggle goes through the injection below.
    }, [terrainExaggeration, forgetLayers, updateLayers]);

    useEffect(() => {
      mapStyleRef.current = mapStyle;
      syncStyle();
    }, [mapStyle, syncStyle]);

    // A page that has just loaded was built with `pageStyleRef`, whichever
    // style the toggle has shown since.
    const syncStyleOnReady = useCallback(() => {
      appliedStyleRef.current = pageStyleRef.current;
      syncStyle();
    }, [syncStyle]);

    const handleMessage = useMap3DBridge({
      mapReadyRef,
      savedCameraRef,
      onMapClickRef,
      onSectionClickRef,
      onActivityClickRef,
      updateLayers,
      syncRoute,
      syncStyle: syncStyleOnReady,
      onMapReady,
      onMapFailed,
      onTerrainUnavailable,
      onBearingChange,
      onCameraStateChange,
    });

    // Expose reset method to parent
    useImperativeHandle(
      ref,
      () => ({
        fitBounds: (bounds, padding, duration) => {
          webViewRef.current?.injectJavaScript(buildFitBoundsScript(bounds, padding, duration));
        },
        setCamera: (camera, duration) => {
          webViewRef.current?.injectJavaScript(buildSetCameraScript(camera, duration));
        },
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
    }, [highlightCoordinate, sendHighlight, styleEpoch]);

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
                window.map.setLayoutProperty('section-creation-line-fill', 'visibility', 'visible');
              } else {
                window.map.setLayoutProperty('section-creation-line-fill', 'visibility', 'none');
              }
            } else if (lineData) {
              window.map.addSource('section-creation-line', { type: 'geojson', data: lineData });
              ${JSON.stringify(sectionCreation3DLayers(true).filter((l) => l.type === 'line'))}.forEach(function(l) { window.map.addLayer(l); });
            }
            // Update section creation markers - re-create if missing
            var markersData = ${markersJSON};
            var markerSource = window.map.getSource('section-creation-markers');
            if (markerSource) {
              if (markersData) {
                markerSource.setData(markersData);
                window.map.setLayoutProperty('section-creation-marker-fill', 'visibility', 'visible');
                window.map.setLayoutProperty('section-creation-marker-icon', 'visibility', 'visible');
              } else {
                window.map.setLayoutProperty('section-creation-marker-fill', 'visibility', 'none');
                window.map.setLayoutProperty('section-creation-marker-icon', 'visibility', 'none');
              }
            } else if (markersData) {
              window.map.addSource('section-creation-markers', { type: 'geojson', data: markersData });
              ${JSON.stringify(sectionCreation3DLayers(true).filter((l) => l.type === 'circle'))}.forEach(function(l) { window.map.addLayer(l); });
              window.map.addLayer({
                id: 'section-creation-marker-icon', type: 'symbol', source: 'section-creation-markers',
                layout: { 'text-field': ['case', ['==', ['get', 'type'], 'start'], '\\u25B6', '\\u25A0'], 'text-font': ${jsLiteralList(BUNDLED_TEXT_FONT)}, 'text-size': 10, 'text-allow-overlap': true, 'text-ignore-placement': true },
                paint: { 'text-color': ${jsLiteral(mapLayerColors.casing)} },
              });
            }
          } catch (e) { console.warn('[3D] Section creation layer error:', e); }
        })();
        true;
      `);
    }, [sectionCreationGeoJSON, sectionCreationStart, sectionCreationEnd, styleEpoch]);

    // Toggle heatmap visibility dynamically (without regenerating HTML).
    // Visibility, not opacity: a hidden raster layer still fetches its tiles.
    useEffect(() => {
      if (!webViewRef.current || !mapReadyRef.current) return;
      const visibility = showHeatmap ? 'visible' : 'none';
      webViewRef.current.injectJavaScript(`
        if (window.map && window.map.getLayer('heatmap-layer')) {
          window.map.setLayoutProperty('heatmap-layer', 'visibility', ${jsLiteral(visibility)});
        }
        true;
      `);
    }, [showHeatmap]);

    // MapLibre does not ask again for a tile URL it has resolved, so a finished
    // pass reaches the page as a new URL on the existing source.
    useEffect(() => {
      if (sentHeatmapGenerationRef.current === heatmapGeneration) return;
      if (!webViewRef.current || !mapReadyRef.current) return;
      sentHeatmapGenerationRef.current = heatmapGeneration;
      webViewRef.current.injectJavaScript(`
        if (window.map && window.map.getSource('heatmap-tiles')) {
          window.map.getSource('heatmap-tiles').setTiles([${jsLiteral(heatmapTileTemplate(heatmapGeneration))}]);
        }
        true;
      `);
    }, [heatmapGeneration]);

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

    boundsRef.current = bounds;

    // Swap the drawn route and its colour on the page that is already up.
    useEffect(() => {
      syncRoute();
    }, [coordinates, routeColor, routeGradient, bounds, syncRoute]);

    // Use initial center/zoom when no coordinates provided

    // Generate the HTML for the WebView
    // IMPORTANT: Only depends on style-related props, NOT GeoJSON data
    // GeoJSON layers are updated dynamically via injectJavaScript
    const html = useMemo(() => {
      // Reset map ready state when HTML regenerates
      mapReadyRef.current = false;
      pageStyleRef.current = mapStyle;
      // A rebuilt page holds nothing, so the next update sends everything.
      sentLayersRef.current = {};
      // Built from what is selected now, not from what was when the page first
      // mounted, so a rebuild for pitch or exaggeration keeps the selection.
      pageRouteRef.current = {
        coordinates: coordinatesRef.current,
        color: routeColorRef.current,
      };
      drawnRouteRef.current = pageRouteRef.current;
      drawnGradientRef.current = null;

      // Use saved camera position if available (from previous style change),
      // then fall back to initialCamera override (from parent), then to initial props.
      const savedCamera = savedCameraRef.current ?? initialCameraRef.current;
      const centerOverride = savedCamera ? savedCamera.center : (initialCenterRef.current ?? null);
      const zoom = savedCamera ? savedCamera.zoom : (initialZoomRef.current ?? 12);
      const bearing = savedCamera ? savedCamera.bearing : 0;
      const pitch = savedCamera ? savedCamera.pitch : initialPitch;

      return buildMap3DHtml({
        coordinates: coordinatesRef.current,
        bounds: boundsRef.current,
        centerOverride,
        zoom,
        bearing,
        pitch,
        hasSavedCamera: !!savedCamera,
        terrainExaggeration,
        // The style in effect when the page is built, so a rebuild after a
        // basemap toggle does not come up in the first-mounted one. It is not a
        // memo dependency because style changes go through setStyle() injection,
        // not HTML regeneration.
        initStyle: mapStyle,
        mapStyle,
        routeColor: routeColorRef.current,
        showHeatmap: showHeatmapRef.current,
        heatmapGeneration: heatmapGenerationRef.current,
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
      // eslint-disable-next-line react-hooks/exhaustive-deps -- Style and geometry updates enter the existing page through injection.
    }, [initialPitch, terrainExaggeration]);

    return (
      <View style={styles.container}>
        <WebView
          ref={webViewRef}
          source={{ html, baseUrl: mapPageBaseUrl() }}
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
