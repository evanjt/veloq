import type { MapStyleType } from '@/features/maps/components/mapStyles';
import {
  getSnapshotSatelliteStyle,
  rewriteSatelliteUrls,
  TERRAIN_3D_CONFIG,
} from '@/features/maps/components/mapStyles';
import { DARK_MATTER_STYLE } from '@/features/maps/components/darkMatterStyle';
import type { TerrainCamera } from '@/features/maps/lib/cameraAngle';

export interface SnapshotRequest {
  activityId: string;
  coordinates: [number, number][];
  camera: TerrainCamera;
  mapStyle: MapStyleType;
  routeColor: string;
  /** Flat top-down basemap - no terrain drape, sky, or hillshade */
  flat?: boolean;
  _retryAttempt?: number;
}

// Builds the injected JS that renders one snapshot request - a 3D terrain
// drape, or a flat top-down basemap when request.flat - and posts the captured
// JPEG back to the worker bridge. Derives the base style, terrain, sky, and
// hillshade config from the request.
export function buildRenderSnapshotScript(
  request: SnapshotRequest,
  workerId: number,
  gen: number
): string {
  const isSatellite = request.mapStyle === 'satellite';
  const isDark = request.mapStyle === 'dark' || request.mapStyle === 'satellite';
  const isFlat = request.flat === true;

  // Satellite and dark: use inline style objects.
  // Light: fetch full Liberty style from URL (same as detail 3D view).
  const isLight = !isSatellite && request.mapStyle !== 'dark';
  // Satellite: rewrite to cached protocol for tile caching.
  // Dark: keep original TileJSON URL - let MapLibre fetch tiles natively
  // (cached-vector:// rewrite was causing blank features after setStyle).
  // Light: fetch URL-based style in JS.
  const styleConfig = isSatellite
    ? JSON.stringify(
        rewriteSatelliteUrls(
          getSnapshotSatelliteStyle(
            request.camera.center[1],
            request.camera.center[0],
            request.camera.zoom
          )
        )
      )
    : isLight
      ? 'null'
      : JSON.stringify(DARK_MATTER_STYLE);
  const lightStyleUrl = isLight ? 'https://tiles.openfreemap.org/styles/liberty' : '';

  const coordsJSON = JSON.stringify(request.coordinates);
  const cameraJSON = JSON.stringify(request.camera);

  // Serialize shared terrain config values for injection into WebView JS
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

  return `
          (function() {
            try {
              var workerId = ${workerId};
              var coords = ${coordsJSON};
              var camera = ${cameraJSON};
              var isSatellite = ${isSatellite};
              var isDark = ${isDark};
              var isFlat = ${isFlat};
              var routeColor = '${request.routeColor}';
              var lightStyleUrl = '${lightStyleUrl}';
              var inlineStyle = ${styleConfig};
              var activityId = '${request.activityId}';
              var mapStyle = '${request.mapStyle}';
              var myGen = ${gen};
              var terrainSource = ${terrainSourceJSON};
              var skyConfig = ${skyConfigJSON};
              var hillshadePaint = ${hillshadePaintJSON};
              var hillshadeInsertCandidates = ${JSON.stringify(TERRAIN_3D_CONFIG.hillshadeInsertBeforeCandidates)};

              window._snapshotGen = myGen;
              window._tileErrorCount = 0;

              function isStale() {
                return window._snapshotGen !== myGen;
              }

              window._rn_log('Snapshot ' + activityId + ' gen=' + myGen + ': ' + coords.length + ' coords, style=' + mapStyle + (isFlat ? ' (flat)' : ' (3d)'));

              function captureSnapshot() {
                if (isStale()) { window._rn_log('gen=' + myGen + ' superseded, aborting'); return; }
                try {
                  var canvas = window.map.getCanvas();
                  var w = canvas.width;
                  var h = canvas.height;

                  // Sample edge pixels for white-tile detection - regional sources
                  // (e.g. Swisstopo) return opaque white JPEGs outside coverage area
                  var ctx = canvas.getContext('webgl2') || canvas.getContext('webgl');
                  // Flat light/dark basemaps have legitimately pale/uniform areas;
                  // white-tile detection only applies to satellite imagery there,
                  // and gap detection (DEM/sky artefacts) only to 3D renders.
                  if (ctx && (!isFlat || isSatellite)) {
                    var pixel = new Uint8Array(4);
                    var whiteCount = 0;
                    var samplePoints = [
                      [w - 2, Math.floor(h * 0.2)], [w - 2, Math.floor(h * 0.4)],
                      [w - 2, Math.floor(h * 0.6)], [w - 2, Math.floor(h * 0.8)],
                      [Math.floor(w * 0.7), h - 2], [Math.floor(w * 0.8), h - 2],
                      [Math.floor(w * 0.6), Math.floor(h * 0.3)], [Math.floor(w * 0.9), Math.floor(h * 0.5)],
                    ];
                    for (var si = 0; si < samplePoints.length; si++) {
                      var sx = samplePoints[si][0];
                      var sy = h - samplePoints[si][1] - 1; // WebGL y is flipped
                      ctx.readPixels(sx, sy, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, pixel);
                      if (pixel[0] >= 252 && pixel[1] >= 252 && pixel[2] >= 252) {
                        whiteCount++;
                      }
                    }
                    if (whiteCount >= 2) {
                      window._rn_log('White tile detected (' + whiteCount + '/8 samples), rejecting');
                      window.ReactNativeWebView.postMessage(JSON.stringify({
                        type: 'snapshotError',
                        workerId: workerId,
                        activityId: activityId,
                        gen: myGen,
                        error: 'White tile detected',
                        tileErrors: window._tileErrorCount,
                      }));
                      return;
                    }
                  }

                  if (ctx && !isFlat) {
                    var pixel = new Uint8Array(4);
                    // Gap pixel detection - sample 6 interior points in the terrain area
                    var gapCount = 0;
                    var interiorPoints = [
                      [Math.floor(w * 0.3), Math.floor(h * 0.5)],
                      [Math.floor(w * 0.5), Math.floor(h * 0.5)],
                      [Math.floor(w * 0.7), Math.floor(h * 0.5)],
                      [Math.floor(w * 0.3), Math.floor(h * 0.7)],
                      [Math.floor(w * 0.5), Math.floor(h * 0.7)],
                      [Math.floor(w * 0.7), Math.floor(h * 0.7)],
                    ];
                    for (var gi = 0; gi < interiorPoints.length; gi++) {
                      var gx = interiorPoints[gi][0];
                      var gy = h - interiorPoints[gi][1] - 1;
                      ctx.readPixels(gx, gy, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, pixel);
                      var r = pixel[0], g = pixel[1], b = pixel[2];
                      var isGap = false;
                      // Pure black = failed DEM tile
                      if (r === 0 && g === 0 && b === 0) isGap = true;
                      // Satellite: sky color range (#1a3a5c area)
                      else if (isSatellite && r < 40 && g < 70 && b > 70 && b < 120) isGap = true;
                      // Dark style: only catch failed DEM tiles (near pure black)
                      else if (!isSatellite && isDark && r < 5 && g < 5 && b < 5) isGap = true;
                      // Light style: background #E8E0D8 range
                      else if (!isSatellite && !isDark && r > 220 && g > 210 && b > 200 && r < 245 && g < 235 && b < 225) isGap = true;
                      if (isGap) gapCount++;
                    }
                    if (gapCount >= 3) {
                      window._rn_log('Gap detected (' + gapCount + '/6 interior samples), rejecting');
                      window.ReactNativeWebView.postMessage(JSON.stringify({
                        type: 'snapshotError',
                        workerId: workerId,
                        activityId: activityId,
                        gen: myGen,
                        error: 'Gap detected (' + gapCount + '/6)',
                        tileErrors: window._tileErrorCount,
                      }));
                      return;
                    }
                  }

                  // Tile error count gate - catches gaps outside sampled pixel locations
                  if (window._tileErrorCount >= 2) {
                    window._rn_log('Tile errors detected (' + window._tileErrorCount + '), rejecting');
                    window.ReactNativeWebView.postMessage(JSON.stringify({
                      type: 'snapshotError',
                      workerId: workerId,
                      activityId: activityId,
                      gen: myGen,
                      error: 'Tile errors: ' + window._tileErrorCount,
                      tileErrors: window._tileErrorCount,
                    }));
                    return;
                  }

                  var dataUrl = canvas.toDataURL('image/jpeg', 0.95);
                  var base64 = dataUrl.split(',')[1];
                  window._rn_log('Captured ' + activityId + ' (' + Math.round(base64.length / 1024) + 'KB)');
                  window.ReactNativeWebView.postMessage(JSON.stringify({
                    type: 'snapshot',
                    workerId: workerId,
                    activityId: activityId,
                    mapStyle: mapStyle,
                    gen: myGen,
                    base64: base64,
                    tileErrors: window._tileErrorCount,
                  }));
                } catch(e) {
                  window._rn_log('Capture error: ' + e.message);
                  window.ReactNativeWebView.postMessage(JSON.stringify({
                    type: 'snapshotError',
                    workerId: workerId,
                    activityId: activityId,
                    gen: myGen,
                    error: e.message,
                    tileErrors: window._tileErrorCount,
                  }));
                }
              }

              // --- Helper: add route sources + layers via map API ---
              // At IIFE scope so both fast path and full path can use it.
              var hasRoute = coords.length > 0;

              function addRouteLayers() {
                if (!hasRoute) return;
                var startPt = coords[0];
                var endPt = coords[coords.length - 1];
                try { window.map.removeLayer('start-end-fill'); } catch(e) {}
                try { window.map.removeLayer('start-end-border'); } catch(e) {}
                try { window.map.removeLayer('route-line'); } catch(e) {}
                try { window.map.removeLayer('route-outline'); } catch(e) {}
                try { window.map.removeSource('start-end-markers'); } catch(e) {}
                try { window.map.removeSource('route'); } catch(e) {}
                window.map.addSource('route', {
                  type: 'geojson',
                  data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } },
                  tolerance: 0,
                });
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
                  id: 'route-outline', type: 'line', source: 'route',
                  layout: { 'line-join': 'round', 'line-cap': 'round' },
                  paint: { 'line-color': '#FFFFFF', 'line-width': 5, 'line-opacity': 0.8 },
                });
                window.map.addLayer({
                  id: 'route-line', type: 'line', source: 'route',
                  layout: { 'line-join': 'round', 'line-cap': 'round' },
                  paint: { 'line-color': routeColor, 'line-width': 3 },
                });
                window.map.addLayer({
                  id: 'start-end-border', type: 'circle', source: 'start-end-markers',
                  paint: { 'circle-radius': 7, 'circle-color': '#FFFFFF' },
                });
                window.map.addLayer({
                  id: 'start-end-fill', type: 'circle', source: 'start-end-markers',
                  paint: {
                    'circle-radius': 5,
                    'circle-color': ['case', ['==', ['get', 'type'], 'start'], 'rgba(34,197,94,0.75)', 'rgba(239,68,68,0.75)'],
                  },
                });
                window._rn_log('Route layers added via API');
              }

              // --- Helper: add terrain + hillshade (no route yet) ---
              // Route is added AFTER terrain is fully rendered (separate idle cycle)
              // so the drape texture re-render includes the route.
              function addTerrain() {
                window.map.addSource('terrain', terrainSource);
                window.map.setTerrain({ source: 'terrain', exaggeration: ${TERRAIN_3D_CONFIG.defaultExaggeration} });
                try { window.map.setSky(skyConfig); } catch(e) {}
                if (!isSatellite) {
                  var beforeId = null;
                  for (var ci = 0; ci < hillshadeInsertCandidates.length; ci++) {
                    if (window.map.getLayer(hillshadeInsertCandidates[ci])) {
                      beforeId = hillshadeInsertCandidates[ci];
                      break;
                    }
                  }
                  window.map.addLayer({
                    id: 'hillshading', type: 'hillshade', source: 'terrain',
                    layout: { visibility: 'visible' },
                    paint: hillshadePaint,
                  }, beforeId);
                }
                window._rn_log('Terrain + hillshade added via API');
              }

              // --- Fast path: same base style + mode, just update camera + route ---
              var baseMode = isFlat ? 'flat' : '3d';
              if (window._currentBaseStyle === mapStyle && window._currentBaseMode === baseMode && coords.length > 0) {
                if (isFlat || window.map.getSource('terrain')) {
                  window.map.jumpTo({
                    center: camera.center, zoom: camera.zoom,
                    bearing: camera.bearing, pitch: camera.pitch,
                  });
                  window._rn_log('Fast path: jumped camera, waiting for terrain...');
                  var done = false;
                  var fpStart = Date.now();
                  var fpLastData = 0;

                  function fpOnData() { fpLastData = Date.now(); }
                  window.map.on('data', fpOnData);

                  // Helper: add route layers after terrain settles, then capture
                  function fpAddRouteAndCapture(reason) {
                    window._rn_log(reason);
                    addRouteLayers();
                    window.map.once('idle', function() {
                      window._rn_log('Fast path route idle, capturing...');
                      requestAnimationFrame(function() { setTimeout(captureSnapshot, 50); });
                    });
                  }

                  // Fast path: idle event - deferred by one frame so MapLibre
                  // processes the camera change and queues tile requests first.
                  requestAnimationFrame(function() {
                    window.map.once('idle', function() {
                      if (done || isStale()) return;
                      done = true;
                      window.map.off('data', fpOnData);
                      fpAddRouteAndCapture('Fast path idle, adding route...');
                    });
                  });

                  // Fast path: poll for tile activity settlement
                  var fpPoll = setInterval(function() {
                    if (done || isStale()) { clearInterval(fpPoll); return; }
                    var now = Date.now();
                    var quietTime = fpLastData > 0 ? now - fpLastData : 0;

                    if (fpLastData > 0 && window.map.isStyleLoaded()) {
                      done = true;
                      clearInterval(fpPoll);
                      window.map.off('data', fpOnData);
                      fpAddRouteAndCapture('Fast path styleLoaded');
                      return;
                    }
                    if (fpLastData > 0 && quietTime > 1500) {
                      done = true;
                      clearInterval(fpPoll);
                      window.map.off('data', fpOnData);
                      fpAddRouteAndCapture('Fast path settled (' + quietTime + 'ms quiet)');
                      return;
                    }
                    if (now - fpStart > 5000) {
                      done = true;
                      clearInterval(fpPoll);
                      window.map.off('data', fpOnData);
                      fpAddRouteAndCapture('Fast path max wait (5s)');
                      return;
                    }
                  }, 500);

                  setTimeout(function() {
                    clearInterval(fpPoll);
                    window.map.off('data', fpOnData);
                    if (!done && !isStale()) {
                      done = true;
                      window._rn_log('Fast path timeout (6s)');
                      window.ReactNativeWebView.postMessage(JSON.stringify({
                        type: 'snapshotError', workerId: workerId, activityId: activityId,
                        gen: myGen, error: 'Fast path render timeout',
                        tileErrors: window._tileErrorCount,
                      }));
                    }
                  }, 6000);
                  return;
                }
              }

              // --- Full path: everything in style JSON (atomic) ---
              function applyStyle(styleObj) {

              // Embed terrain, hillshade, and route directly in the style JSON
              // so the drape texture includes the route from the very first render.
              // Flat mode: plain basemap - no terrain, sky, or hillshade.
              if (!isFlat) {
                styleObj.sources['terrain'] = terrainSource;
                styleObj.terrain = { source: 'terrain', exaggeration: ${TERRAIN_3D_CONFIG.defaultExaggeration} };
                styleObj.sky = skyConfig;
              }

              // Insert hillshade before the first transportation/building layer
              if (!isFlat && !isSatellite) {
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

              // Add route source + layers at the end of the style
              if (hasRoute) {
                var startPt = coords[0];
                var endPt = coords[coords.length - 1];

                styleObj.sources['route'] = {
                  type: 'geojson',
                  data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } },
                  tolerance: 0,
                };
                styleObj.sources['start-end-markers'] = {
                  type: 'geojson',
                  data: {
                    type: 'FeatureCollection',
                    features: [
                      { type: 'Feature', properties: { type: 'start' }, geometry: { type: 'Point', coordinates: startPt } },
                      { type: 'Feature', properties: { type: 'end' }, geometry: { type: 'Point', coordinates: endPt } },
                    ],
                  },
                };

                styleObj.layers.push({
                  id: 'route-outline', type: 'line', source: 'route',
                  layout: { 'line-join': 'round', 'line-cap': 'round' },
                  paint: { 'line-color': '#FFFFFF', 'line-width': 5, 'line-opacity': 0.8 },
                });
                styleObj.layers.push({
                  id: 'route-line', type: 'line', source: 'route',
                  layout: { 'line-join': 'round', 'line-cap': 'round' },
                  paint: { 'line-color': routeColor, 'line-width': 3 },
                });
                styleObj.layers.push({
                  id: 'start-end-border', type: 'circle', source: 'start-end-markers',
                  paint: { 'circle-radius': 7, 'circle-color': '#FFFFFF' },
                });
                styleObj.layers.push({
                  id: 'start-end-fill', type: 'circle', source: 'start-end-markers',
                  paint: {
                    'circle-radius': 5,
                    'circle-color': ['case', ['==', ['get', 'type'], 'start'], 'rgba(34,197,94,0.75)', 'rgba(239,68,68,0.75)'],
                  },
                });
              }

              window._rn_log('setStyle (all-in-one): ' + styleObj.layers.length + ' layers, '
                + Object.keys(styleObj.sources).length + ' sources'
                + (styleObj.glyphs ? ', glyphs OK' : ', NO glyphs')
                + (styleObj.sprite ? ', sprite OK' : ', NO sprite'));
              window.map.setStyle(styleObj);
              window.map.jumpTo({
                center: camera.center,
                zoom: camera.zoom,
                bearing: camera.bearing,
                pitch: camera.pitch,
              });

              // Wait for everything to load (DEM + vector + route tiles)
              window._tileStats = {};
              _rafCount = 0;
              var done = false;
              var setStyleTime = Date.now();

              var readyPoll = setInterval(function() {
                if (done || isStale()) { clearInterval(readyPoll); return; }
                var elapsed = Date.now() - setStyleTime;

                if (window.map.isStyleLoaded() || elapsed > 5000) {
                  done = true;
                  clearInterval(readyPoll);
                  window._currentBaseStyle = mapStyle;
                  window._currentBaseMode = baseMode;
                  window._rn_log('All loaded after ' + elapsed + 'ms, capturing...');
                  requestAnimationFrame(function() { setTimeout(captureSnapshot, 50); });
                  return;
                }
              }, 200);

              // Hard timeout
              setTimeout(function() {
                clearInterval(readyPoll);
                if (!done && !isStale()) {
                  done = true;
                  window._rn_log('Hard timeout (6s), skipping');
                  window.ReactNativeWebView.postMessage(JSON.stringify({
                    type: 'snapshotError',
                    workerId: workerId,
                    activityId: activityId,
                    gen: myGen,
                    error: 'Render timeout',
                    tileErrors: window._tileErrorCount,
                  }));
                }
              }, 6000);

              } // end applyStyle

              // Light mode: fetch full Liberty style from URL, then apply.
              // Don't rewrite vector URLs - let MapLibre handle TileJSON natively.
              // Dark/satellite: use the inline style object directly.
              if (lightStyleUrl) {
                window._rn_log('Fetching Liberty style for light mode...');
                fetch(lightStyleUrl)
                  .then(function(r) { return r.json(); })
                  .then(function(fetchedStyle) {
                    if (isStale()) return;
                    applyStyle(fetchedStyle);
                  })
                  .catch(function(err) {
                    window._rn_log('Liberty fetch failed: ' + err.message + ', using fallback');
                    applyStyle(inlineStyle || { version: 8, sources: {}, layers: [] });
                  });
              } else {
                applyStyle(inlineStyle);
              }

            } catch(e) {
              window._rn_log('Error: ' + e.message);
              if (window.ReactNativeWebView) {
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: 'snapshotError',
                  workerId: ${workerId},
                  activityId: '${request.activityId}',
                  gen: ${gen},
                  error: e.message,
                }));
              }
            }
          })();
          true;
  `;
}
