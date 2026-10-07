/**
 * HTML builder for the 3D terrain WebView (`Map3DWebView`).
 *
 * Produces the full `<!DOCTYPE html>` string embedded in the WebView, with all
 * dynamic values injected via `${...}` template literal interpolation. The
 * generated HTML is byte-for-byte equivalent to the inline template that used
 * to live in `Map3DWebView.tsx`.
 *
 * The builder is intentionally a pure function so callers can compose it from
 * `useMemo` with whatever dependency array they need. Keep all React-specific
 * state (refs, savedCameraRef, etc.) on the caller's side - pass only resolved
 * values here.
 */
import { MAP_3D_READY_TIMEOUT_MS } from '@/features/maps/lib/mapBudgets';
import { TRACK_FIT_PADDING } from '@/features/maps/lib/activityCamera';
import {
  HILLSHADE_INSERT_INDEX_SCRIPT,
  TERRAIN_3D_CONFIG,
  terrain3DSource,
} from '@/features/maps/components/mapStyles';
import type { MapStyleType } from '@/features/maps/components/mapStyles';
import { resolveStyleExpression } from './styleResolution';
import { SURFACE_HIT_TEST_RADIUS_PX } from './mapSurface';
import {
  consoleBridgeScript,
  mapLibreHead,
  terrainVisibilityScript,
  tileProtocolsScript,
} from './shared';
import { jsLiteral, jsLiteralList } from '@/features/maps/lib/webViewLiterals';
import { sectionCreation3DLayers } from '@/features/maps/lib/sectionCreationPaint';
import { BUNDLED_TEXT_FONT } from '@/features/maps/lib/bundledGlyphs';
import { heatmapRasterPaint } from '@/features/maps/lib/heatmapPaint';
import { HEATMAP_SOURCE_MINZOOM, heatmapTileTemplate } from '@/features/maps/lib/heatmapTiles';
import { colors, colorWithOpacity, mapLayerColors, sectionPalette } from '@/theme';

/**
 * What the app says when it declines a tile request of its own.
 *
 * The page logs every MapLibre `error` event, and a rejection the bridge made
 * is not a map error: a heatmap tile the store does not hold is as expected as
 * a 404 from a regional source. The prefix is what tells the two apart, so the
 * bridge rejects with these and the handler suppresses them by name. Bare
 * prose here cost a device session and an investigation.
 */
export const APP_ERROR_PREFIX = 'veloq: ';
export const APP_TILE_MISS = `${APP_ERROR_PREFIX}tile not found`;
export const APP_TILE_READ_ERROR = `${APP_ERROR_PREFIX}tile read error`;

export interface Map3DHtmlConfig {
  /** Route coordinates as [lng, lat] pairs. Empty array = no route layer. */
  coordinates: [number, number][];
  /** Fit-bounds object `{ sw: [lng,lat], ne: [lng,lat] }` or null to skip fitBounds. */
  bounds: { sw: [number, number]; ne: [number, number] } | null;
  /** Saved/initial camera center (`[lng, lat]`). When null, bounds fitting is used (or world view). */
  centerOverride: [number, number] | null;
  /** Initial zoom level. */
  zoom: number;
  /** Initial camera bearing in degrees. */
  bearing: number;
  /** Initial camera pitch in degrees (0-85). */
  pitch: number;
  /**
   * True when the caller has a saved camera state and wants to bypass
   * bounds-fit on first load. Forwarded into the generated JS so the
   * `buildMapOptions(...)` helper picks `center + zoom` over `bounds`.
   */
  hasSavedCamera: boolean;
  /** Terrain exaggeration factor applied to the DEM source. */
  terrainExaggeration: number;
  /**
   * Initial base style for the map. Subsequent style changes happen via
   * `setStyle()` injection in the caller - this only influences the first
   * render so switching styles doesn't regenerate the HTML.
   */
  initStyle: MapStyleType;
  /**
   * Current live map style (may differ from `initStyle` if the user has
   * changed it since HTML was last generated). Used only for the heatmap
   * `isLightMap` calculation; preserves the quirky existing behavior where
   * `mapStyle` isn't a useMemo dependency but is still captured by closure.
   */
  mapStyle: MapStyleType;
  /** Hex color for the route line. */
  routeColor: string;
  /** When true, heatmap raster overlay is visible on first render. */
  showHeatmap: boolean;
  /** Finished tile passes so far, which versions the heatmap tile URL. */
  heatmapGeneration?: number | undefined;
  /** Device pixel ratio to hand to MapLibre (already capped by caller). */
  devicePixelRatio: number;
}

/**
 * Build the complete HTML string for the 3D terrain WebView.
 *
 * All interpolations match the positions of the inline template that used to
 * live in `Map3DWebView.tsx`. Any edits here must preserve runtime behavior.
 */
export function buildMap3DHtml(config: Map3DHtmlConfig): string {
  const {
    coordinates,
    bounds,
    centerOverride,
    zoom,
    bearing,
    pitch,
    hasSavedCamera,
    terrainExaggeration,
    initStyle,
    mapStyle,
    routeColor,
    showHeatmap,
    heatmapGeneration = 0,
    devicePixelRatio,
  } = config;

  const coordsJSON = JSON.stringify(coordinates);
  const boundsJSON = bounds ? JSON.stringify(bounds) : 'null';
  const centerJSON = centerOverride ? JSON.stringify(centerOverride) : 'null';

  const isSatellite = initStyle === 'satellite';
  const isDark = initStyle === 'dark' || initStyle === 'satellite';

  // Serialize shared terrain config for injection into initial HTML.
  const initTerrainSourceJSON = JSON.stringify(terrain3DSource());
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

  const { styleJSON: styleConfig } = resolveStyleExpression(initStyle);

  return `${mapLibreHead({ title: '3D Map' })}
<body>
  <div id="map"></div>
  <script>
${consoleBridgeScript()}

    // The ready signal is the only thing that clears the loading spinner, so
    // it is armed before anything that can throw. The page reports setup failures.
    var mapReadySent = false;
    var mapFailedSent = false;

    function sendMapReady() {
      if (mapReadySent || mapFailedSent) return;
      mapReadySent = true;
      window._rn_log('sending mapReady');
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'mapReady' }));
      }
      reportTerrainState();
    }

    // The renderer ships in the app but the DEM tiles do not, so an offline 3D
    // open draws a flat map that looks like broken 3D. Reported once, after
    // the page has settled, so the caller can drop back to 2D and say why.
    //
    // Deliveries and failures, not cache hits and misses: the DEM comes
    // through the intercept, so the page has no handler of its own on that
    // path and reads both off MapLibre's source events instead. A page with
    // failures and no deliveries has no terrain at all.
    var terrainDelivered = 0, terrainFailed = 0;
    var terrainReportSent = false;

    function reportTerrainState() {
      if (terrainReportSent) return;
      if (terrainDelivered > 0 || terrainFailed === 0) return;
      terrainReportSent = true;
      window._rn_log('sending terrainUnavailable - ' + terrainFailed + ' DEM tiles failed');
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'terrainUnavailable',
          reason: 'no terrain tiles: ' + terrainFailed + ' failed, none delivered'
        }));
      }
    }

    function sendMapFailed(reason) {
      if (mapReadySent || mapFailedSent) return;
      mapFailedSent = true;
      window._rn_log('sending mapFailed - ' + reason);
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'mapFailed',
          reason: String(reason)
        }));
      }
    }

    if (window.addEventListener) {
      window.addEventListener('error', function(e) {
        sendMapFailed('page error: ' + ((e && e.message) || 'unknown'));
      });
    }

    setTimeout(function() { sendMapFailed('ready timeout'); }, ${MAP_3D_READY_TIMEOUT_MS});

    const coordinates = ${coordsJSON};
    window._routeCoords = coordinates;

    // The two point features the start and end dots are drawn from.
    function _startEndOf(line) {
      if (!line || line.length === 0) return { type: 'FeatureCollection', features: [] };
      return {
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', properties: { type: 'start' }, geometry: { type: 'Point', coordinates: line[0] } },
          { type: 'Feature', properties: { type: 'end' }, geometry: { type: 'Point', coordinates: line[line.length - 1] } },
        ],
      };
    }
    const bounds = ${boundsJSON};
    const center = ${centerJSON};
    const savedZoom = ${zoom};
    const savedBearing = ${bearing};
    const savedPitch = ${pitch};
    const isSatellite = ${isSatellite};
    const _terrainSource = ${initTerrainSourceJSON};
    const _skyConfig = ${initSkyConfigJSON};
    const _hillshadePaint = ${initHillshadePaintJSON};
    ${HILLSHADE_INSERT_INDEX_SCRIPT}
    const _hillshadeInsertCandidates = ${JSON.stringify(TERRAIN_3D_CONFIG.hillshadeInsertBeforeCandidates)};

${tileProtocolsScript()}

${terrainVisibilityScript()}

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
      if (bounds && !${hasSavedCamera}) {
        opts.bounds = [bounds.sw, bounds.ne];
        opts.fitBoundsOptions = { padding: ${TRACK_FIT_PADDING} };
      } else if (center) {
        opts.center = center;
        opts.zoom = savedZoom;
      } else {
        opts.center = [0, 0];
        opts.zoom = 2;
      }
      return opts;
    }

    try {
    var styleJSON = ${styleConfig};
    window._rn_log('creating map with inline style');
    window.map = new maplibregl.Map(buildMapOptions(styleJSON));

    var map = window.map;

    // Surface map-level errors, but not the expected ones: a tile 404 from a
    // regional source, and a request the app itself declined. What is left is
    // logged with its source and its URL, because a message alone sends the
    // next reader looking for a cause that is not in it.
    map.on('sourcedata', function(e) {
      if (e.sourceId === 'terrain' && e.tile) terrainDelivered++;
    });

    map.on('error', function(e) {
      var msg = e.error ? e.error.message || String(e.error) : e.message || '';
      if (e.sourceId === 'terrain' && e.tile) terrainFailed++;
      if (msg.indexOf('HTTP 4') === 0) return;
      if (msg.indexOf(${jsLiteral(APP_ERROR_PREFIX)}) === 0) return;
      var where = '';
      if (e.sourceId) where += ' [' + e.sourceId + ']';
      if (e.error && e.error.url) where += ' ' + e.error.url;
      window._rn_log('map error: ' + msg + where);
    });

    // Track camera changes and save state for restoration
    function saveCameraState(e) {
      if (window.ReactNativeWebView) {
        var c = map.getCenter();
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'cameraState',
          gesture: !!(e && e.originalEvent),
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

    // The opening camera is turned off a hiding ridge once, and only while the
    // athlete has neither saved a camera nor moved this one.
    var _athleteMoved = false, _openingChecked = false;
    ['movestart', 'zoomstart', 'rotatestart', 'pitchstart'].forEach(function(name) {
      map.on(name, function(e) { if (e && e.originalEvent) _athleteMoved = true; });
    });

    function turnOpeningCamera() {
      if (_openingChecked) return;
      _openingChecked = true;
      if (${hasSavedCamera} || _athleteMoved || coordinates.length < 2 || !window._pickUnhiddenCamera) return;
      try {
        var c = map.getCenter();
        var opening = { center: [c.lng, c.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
        var spans = bounds ? [bounds.ne[0] - bounds.sw[0], bounds.ne[1] - bounds.sw[1]] : [0, 0];
        var picked = window._pickUnhiddenCamera(map, opening, coordinates, spans);
        if (picked !== opening) {
          window._rn_log('Terrain hides the route, opening at bearing ' + picked.bearing + ' pitch ' + picked.pitch);
          map.jumpTo(picked);
        }
      } catch (e) {
        window._rn_log('opening camera check failed: ' + e.message);
      }
    }

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

      // Sky/fog from shared config - setSky may not be available, cosmetic only
      try {
        map.setSky(_skyConfig);
        window._rn_log('sky set');
      } catch(e) {
        window._rn_log('setSky unavailable (ok): ' + e.message);
      }

      // Add hillshade before the first transportation/building layer found
      if (!isSatellite) {
        var _styleLayers = map.getStyle().layers;
        var _hillshadeIdx = hillshadeInsertIndex(_styleLayers, _hillshadeInsertCandidates);
        var _hillshadeBefore = _hillshadeIdx < _styleLayers.length ? _styleLayers[_hillshadeIdx].id : undefined;
        window._rn_log('hillshade insert before: ' + (_hillshadeBefore || 'end'));
        map.addLayer({
          id: 'hillshading',
          type: 'hillshade',
          source: 'terrain',
          layout: { visibility: 'visible' },
          paint: _hillshadePaint,
        }, _hillshadeBefore);
      }

      // The route layers are always mounted, empty and hidden when there is no
      // route. Keying the page on the selected activity's coordinates instead
      // rebuilt the whole terrain page on every tap, which reboots maplibre
      // and refetches every DEM and hillshade tile. window._veloq3d.setRoute
      // below is how a later selection arrives.
      var hasRoute = coordinates.length > 0;
      {
        map.addSource('route', {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: hasRoute ? [{
              type: 'Feature',
              properties: {},
              geometry: { type: 'LineString', coordinates: coordinates },
            }] : [],
          },
          tolerance: 0,
          lineMetrics: true,
        });

        // Route outline (for contrast)
        map.addLayer({
          id: 'route-outline',
          type: 'line',
          source: 'route',
          layout: {
            'line-join': 'round',
            'line-cap': 'round',
            visibility: hasRoute ? 'visible' : 'none',
          },
          paint: {
            'line-color': ${jsLiteral(mapLayerColors.casing)},
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
            visibility: hasRoute ? 'visible' : 'none',
          },
          paint: {
            'line-color': ${jsLiteral(routeColor)},
            'line-width': 3,
          },
        });

        // Start/end circle markers
        map.addSource('start-end-markers', {
          type: 'geojson',
          data: _startEndOf(coordinates),
        });
        // White border ring
        map.addLayer({
          id: 'start-end-border',
          type: 'circle',
          source: 'start-end-markers',
          layout: { visibility: hasRoute ? 'visible' : 'none' },
          paint: {
            'circle-radius': 7,
            'circle-color': ${jsLiteral(mapLayerColors.casing)},
          },
        });
        // Colored fill (green start, red end)
        map.addLayer({
          id: 'start-end-fill',
          type: 'circle',
          source: 'start-end-markers',
          layout: { visibility: hasRoute ? 'visible' : 'none' },
          paint: {
            'circle-radius': 5,
            'circle-color': ['case', ['==', ['get', 'type'], 'start'], ${jsLiteral(colorWithOpacity(colors.success, 0.75))}, ${jsLiteral(colorWithOpacity(colors.error, 0.75))}],
          },
        });
      }

      // Swap the drawn route without rebuilding the page. Injected from React
      // Native when the selected activity changes.
      window._veloq3d = window._veloq3d || {};
      window._veloq3d.gradient = null;
      window._veloq3d.setRouteGradient = function(expression) {
        window._veloq3d.gradient = expression;
        try {
          if (map.getLayer('route-line')) map.setPaintProperty('route-line', 'line-gradient', expression);
        } catch (e) {
          window._rn_log('setRouteGradient failed: ' + e.message);
        }
      };
      window._veloq3d.setRoute = function(next, color) {
        try {
          var on = next && next.length > 0;
          window._routeCoords = next || [];
          if (color && map.getLayer('route-line')) map.setPaintProperty('route-line', 'line-color', color);
          map.getSource('route').setData({
            type: 'FeatureCollection',
            features: on ? [{
              type: 'Feature',
              properties: {},
              geometry: { type: 'LineString', coordinates: next },
            }] : [],
          });
          map.getSource('start-end-markers').setData(_startEndOf(next || []));
          ['route-outline', 'route-line', 'start-end-border', 'start-end-fill'].forEach(function(id) {
            if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
          });
        } catch (e) {
          window._rn_log('setRoute failed: ' + e.message);
        }
      };

      // Create highlight marker as map layers (not DOM marker - immune to terrain occlusion)
      map.addSource('highlight-point', {
        type: 'geojson',
        data: { type: 'Point', coordinates: [0, 0] },
      });
      map.addLayer({
        id: 'highlight-border',
        type: 'circle',
        source: 'highlight-point',
        paint: { 'circle-radius': 7, 'circle-color': ${jsLiteral(mapLayerColors.casing)} },
        layout: { visibility: 'none' },
      });
      map.addLayer({
        id: 'highlight-fill',
        type: 'circle',
        source: 'highlight-point',
        paint: { 'circle-radius': 5, 'circle-color': ${jsLiteral(sectionPalette[0])} },
        layout: { visibility: 'none' },
      });

      // Section creation layers - used for interactive section creation in 3D mode
      // Line showing the selected section portion
      map.addSource('section-creation-line', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      ${JSON.stringify(sectionCreation3DLayers(false).filter((l) => l.type === 'line'))}.forEach(function(l) { map.addLayer(l); });

      // Section creation start/end markers
      map.addSource('section-creation-markers', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      ${JSON.stringify(sectionCreation3DLayers(false).filter((l) => l.type === 'circle'))}.forEach(function(l) { map.addLayer(l); });
      map.addLayer({
        id: 'section-creation-marker-icon',
        type: 'symbol',
        source: 'section-creation-markers',
        layout: {
          'text-field': ['case', ['==', ['get', 'type'], 'start'], '▶', '■'],
          'text-font': ${jsLiteralList(BUNDLED_TEXT_FONT)},
          'text-size': 10,
          'text-allow-overlap': true,
          'text-ignore-placement': true,
          visibility: 'none',
        },
        paint: { 'text-color': ${jsLiteral(mapLayerColors.casing)} },
      });

      // Click handler - posts map coordinates back to React Native
      map.on('click', function(e) {
        // A finger covers about 30 px and a section line is a thin dash, so both
        // queries take a box around the tap, as the 2D page does.
        var hitR = ${SURFACE_HIT_TEST_RADIUS_PX};
        var hitBox = [[e.point.x - hitR, e.point.y - hitR], [e.point.x + hitR, e.point.y + hitR]];
        // Check if the click hit an activity point marker first (global map points)
        try {
          if (map.getLayer('activity-points-layer')) {
            var activityFeatures = map.queryRenderedFeatures(hitBox, { layers: ['activity-points-layer'] });
            if (activityFeatures && activityFeatures.length > 0) {
              var aProps = activityFeatures[0].properties;
              var activityId = aProps && aProps.id;
              if (activityId && window.ReactNativeWebView) {
                // Every point under the tap goes with it: starts stacked on one
                // spot are told apart on the React Native side, which fans them out.
                var hits = activityFeatures.map(function(f) {
                  return { type: 'Feature', properties: f.properties, geometry: f.geometry };
                });
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: 'activityClick',
                  activityId: String(activityId),
                  features: hits
                }));
                return;
              }
            }
          }
        } catch (err) {
          // queryRenderedFeatures may fail if layer was just removed - ignore
        }
        // Section markers on the activity map, ahead of creation-mode map clicks
        try {
          var markerLayers = ['section-marker-circle-3d', 'section-marker-pr-icon-3d'].filter(function(id) {
            return map.getLayer(id);
          });
          if (markerLayers.length > 0) {
            var markerFeatures = map.queryRenderedFeatures(e.point, { layers: markerLayers });
            if (markerFeatures && markerFeatures.length > 0) {
              var mProps = markerFeatures[0].properties;
              var markerSectionId = mProps && mProps.sectionId;
              if (markerSectionId && window.ReactNativeWebView) {
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: 'sectionClick',
                  sectionId: String(markerSectionId)
                }));
                return;
              }
            }
          }
        } catch (err) {
          // queryRenderedFeatures may fail if layer was just removed - ignore
        }
        // Then check section line features
        try {
          if (map.getLayer('sections-layer')) {
            var sectionFeatures = map.queryRenderedFeatures(hitBox, { layers: ['sections-layer'] });
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
          }
        } catch (err) {
          // queryRenderedFeatures may fail if layer was just removed - ignore
        }
        // Otherwise, send a generic map click with coordinates
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'mapClick',
            coordinate: [e.lngLat.lng, e.lngLat.lat]
          }));
        }
      });

      // Heatmap raster overlay. Intercepted where the platform can answer the
      // URL out of the Rust-owned tiles, and over the bridge where it cannot.
      // The beforeId 'route-outline' only exists on activity-detail maps (when coordinates
      // were passed); on the global map the route layer is never added, so passing the
      // missing layer id silently drops the addLayer in some MapLibre versions. Probe
      // for it and only insert behind it when present.
      var showHeatmap = ${showHeatmap};
      map.addSource('heatmap-tiles', {
        type: 'raster',
        tiles: [${jsLiteral(heatmapTileTemplate(heatmapGeneration))}],
        tileSize: 256,
        minzoom: ${HEATMAP_SOURCE_MINZOOM},
        maxzoom: 17
      });
      var heatmapBeforeId = map.getLayer('route-outline') ? 'route-outline' : undefined;
      // Hidden with visibility, never with a zero opacity: a raster layer at
      // zero opacity is still visible to MapLibre, so it requests every tile in
      // the viewport and paints them invisibly.
      map.addLayer({
        id: 'heatmap-layer',
        type: 'raster',
        source: 'heatmap-tiles',
        layout: { visibility: showHeatmap ? 'visible' : 'none' },
        paint: ${JSON.stringify(heatmapRasterPaint(mapStyle))}
      }, heatmapBeforeId);

      // Terrain-first ready detection - only wait for DEM terrain and route sources,
      // not ALL tiles. At 60° pitch, horizon vector/label tiles are deprioritized and
      // may never fully load, causing the old areTilesLoaded() to always hit the timeout.
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

      map.once('idle', turnOpeningCamera);

      // Fallback for when sourcedata doesn't fire (e.g. cached tiles)
      map.once('idle', function() {
        if (!mapReadySent) {
          requestAnimationFrame(function() { sendMapReady(); });
        }
      });

      map.resize(); // Ensure MapLibre knows full WebView dimensions

      // Hard fallback - reduced from 8s to 4s since we no longer wait for all tiles.
      // Terrain + route sources load much faster than full vector tile sets.
      setTimeout(function() {
        if (!mapReadySent) {
          window._rn_log('hard timeout - sending mapReady after 4s');
          sendMapReady();
        }
      }, 4000);

      // A DEM tile that fails after the ready signal still leaves a flat
      // map, so the state is re-read once the page has stopped moving.
      map.once('idle', function() {
        setTimeout(reportTerrainState, 1000);
      });
    });

    } catch(e) {
      window._rn_log('SCRIPT ERROR: ' + e.message + ' at ' + (e.stack || ''));
      sendMapFailed('script error: ' + e.message);
    }
  </script>
</body>
</html>
    `;
}
