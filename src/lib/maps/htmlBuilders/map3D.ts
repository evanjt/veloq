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
 * state (refs, savedCameraRef, etc.) on the caller's side — pass only resolved
 * values here.
 */
import {
  getCombinedSatelliteStyle3D,
  rewriteSatelliteUrls,
  rewriteVectorUrls,
  TERRAIN_3D_CONFIG,
} from '@/components/maps/mapStyles';
import type { MapStyleType } from '@/components/maps/mapStyles';
import { DARK_MATTER_STYLE } from '@/components/maps/darkMatterStyle';

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
   * `setStyle()` injection in the caller — this only influences the first
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
    devicePixelRatio,
  } = config;

  const coordsJSON = JSON.stringify(coordinates);
  const boundsJSON = bounds ? JSON.stringify(bounds) : 'null';
  const centerJSON = centerOverride ? JSON.stringify(centerOverride) : 'null';

  const isSatellite = initStyle === 'satellite';
  const isDark = initStyle === 'dark' || initStyle === 'satellite';

  // Serialize shared terrain config for injection into initial HTML.
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

  // For satellite, we use combined style with all regional sources layered.
  // For dark, we use the bundled Dark Matter style with OpenFreeMap tiles.
  // Rewrite tile URLs to use cached protocols for offline/performance.
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
    const savedZoom = ${zoom};
    const savedBearing = ${bearing};
    const savedPitch = ${pitch};
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
      if (bounds && !${hasSavedCamera}) {
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
        try {
          if (map.getLayer('sections-layer')) {
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
          }
        } catch (err) {
          // queryRenderedFeatures may fail if layer was just removed — ignore
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
}
