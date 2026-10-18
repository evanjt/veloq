import type { MapStyleType } from '@/features/maps/components/mapStyles';
import {
  HILLSHADE_INSERT_INDEX_SCRIPT,
  TERRAIN_3D_CONFIG,
  terrain3DSource,
} from '@/features/maps/components/mapStyles';
import type { TerrainCamera } from '@/features/maps/lib/cameraAngle';
import { resolveStyleForWebView } from './styleResolution';
import { setStyleStatement } from './shared';
import { jsLiteral } from '@/features/maps/lib/webViewLiterals';
import { mapPalette } from '@/theme';
import {
  ENDPOINT_3D_LAYER_IDS,
  ROUTE_3D_LINE_WIDTH,
  endpoint3DLayers,
  routeCasing3DPaint,
  terrainHillshadePaint,
  terrainSky,
} from '@/features/maps/lib/terrain3DPaint';

/**
 * JPEG quality for a captured preview.
 *
 * A preview is a 1080x720 image drawn once, shown at roughly a third of a
 * screen height under a route line and a gradient, and never zoomed. It was
 * 0.95, which is the setting for an image that will be re-encoded, and cost a
 * measured mean of 240 KB on a real device. At 0.8 the same files are 60% of
 * that, and the difference from the 0.95 render measures 1.8% RMSE, which is
 * below what the card's 3:1 downscale would show even if the eye could find it
 * at full size.
 */
export const SNAPSHOT_JPEG_QUALITY = 0.8;

/**
 * The `TERRAIN_CACHE_VERSION` that `SNAPSHOT_JPEG_QUALITY` was last changed at.
 *
 * A device serves the previews it already holds, drawn at whatever the quality
 * was when they were made, so changing the quality without moving the cache
 * version leaves an install on the old setting for its whole life. Keeping the
 * pair here is what lets a test say the two moved together.
 */
export const QUALITY_CACHE_VERSION = 7;

/**
 * How long a render may wait for its tiles, counted from its start and
 * covering a turned camera too. A render not loaded by then posts
 * `snapshotError` rather than a picture with tiles missing. It stays under the
 * host's `SNAPSHOT_TIMEOUT_MS`, which fails a render without a retry.
 */
const RENDER_TIMEOUT_MS = 6000;

/**
 * How far a probed pixel may sit from the style's background colour, per
 * channel, and still be read as background. Kept small, because dark imagery
 * such as deep water can sit near a dark background.
 */
const BACKGROUND_TOLERANCE = 6;

/**
 * The colour of a style's `background` layer as red, green and blue, or null
 * when it has none or the colour is not a hex string.
 */
function styleBackgroundRgb(style: unknown): [number, number, number] | null {
  const layers = (style as { layers?: { type?: string; paint?: Record<string, unknown> }[] })
    ?.layers;
  const color = layers?.find((layer) => layer.type === 'background')?.paint?.['background-color'];
  if (typeof color !== 'string') return null;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())?.[1];
  if (!hex) return null;
  const digits = hex.length === 3 ? hex.replace(/./g, (d) => d + d) : hex;
  return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)) as [number, number, number];
}

/**
 * The colour a 3D render's gap probe reads as a region no tile drew.
 *
 * Satellite imagery covers the globe, so its style's background shows only
 * where an imagery tile is missing. The light and dark styles draw bare land
 * as their background, so a pixel of it there is not a gap and they have none.
 */
function gapBackgroundFor(mapStyle: MapStyleType, style: unknown): [number, number, number] | null {
  return mapStyle === 'satellite' ? styleBackgroundRgb(style) : null;
}

export interface SnapshotRequest {
  activityId: string;
  coordinates: [number, number][];
  camera: TerrainCamera;
  /** The athlete saved this camera, so it is drawn as given and never turned. */
  cameraPinned?: boolean;
  mapStyle: MapStyleType;
  /** Flat top-down basemap - no terrain drape, sky, or hillshade */
  flat?: boolean;
  /**
   * The athlete asked for this one render on the card they are looking at, so
   * it goes to the head of the queue and survives an overflow.
   */
  priority?: boolean;
  /**
   * The card already holds a stand-in for this render and is asking for the
   * one it wanted. Capped per render identity, because a card holding a
   * downgrade asks again every time it mounts.
   */
  upgrade?: boolean;
  // A deliberate stand-in whose successful save queues the terrain render.
  firstPaint?: boolean;
  // The terrain render following a deliberate first paint, outside the retry cap.
  backgroundUpgrade?: boolean;
  // A flat image saved under the terrain key with a downgrade marker.
  standIn?: boolean;
  _retryAttempt?: number;
  /** Epoch milliseconds the request entered the queue, for `snapshot.wait`. */
  _enqueuedAt?: number;
  /** Epoch milliseconds a worker took it, for `snapshot.render`. */
  _startedAt?: number;
}

/**
 * The styles one worker page holds, by name, as the JSON each was given in.
 *
 * A page keeps every style it is given for as long as it lives, so a request
 * for one it holds carries only the request. The pool keeps one per worker and
 * empties it whenever the worker's map comes up, since a page that died or
 * reloaded holds nothing.
 */
export type SnapshotStylesHeld = Map<MapStyleType, string>;

/**
 * The page's render function and the styles it draws from, run once when a
 * worker page loads.
 *
 * The render code and the basemap style are most of what a render needs, and
 * neither changes between requests: a light request carried 68 K characters
 * when the request itself is a route and a camera. So the page defines the
 * function once and holds each style it is given, and a request is the call.
 *
 * Renders one snapshot request - a 3D terrain drape, or a flat top-down
 * basemap when the request is flat - and posts the captured JPEG back to the
 * worker bridge.
 */
export function snapshotRenderScript(): string {
  return `
    // The basemap styles this page has been given, by name, as JSON. Parsed
    // afresh for each render, because a render splices its terrain and route
    // into the object it mounts.
    window._styles = {};

    window._renderSnapshot = function(request) {
            try {
              // Stamped before anything is decided, so the elapsed posted back
              // covers the whole render and not the branch it ended up in.
              window._renderStart = Date.now();
              var deadlineAt = window._renderStart + ${RENDER_TIMEOUT_MS};
              window._renderPath = 'setStyle';
              // Reset before either path can emit source events.
              window._tileStats = {};

              // Each stage is closed by the next one opening, so the four sum
              // to the elapsed posted beside them. A render that aborts part
              // way through stamps only what it reached, and the host records
              // only what it is given, so a stage reads as absent rather than
              // as zero.
              window._phases = {};
              window._phaseAt = window._renderStart;
              function phase(name) {
                var now = Date.now();
                window._phases[name] = now - window._phaseAt;
                window._phaseAt = now;
              }
              var workerId = request.workerId;
              var coords = request.coords;
              var camera = request.camera;
              var isSatellite = request.isSatellite;
              var isDark = request.isDark;
              var isFlat = request.isFlat;
              var cameraPinned = request.cameraPinned;
              var routeColor = request.routeColor;
              var routeCasingPaint = request.routeCasingPaint;
              var routeLineWidth = request.routeLineWidth;
              var endpointLayers = request.endpointLayers;
              var activityId = request.activityId;
              var mapStyle = request.mapStyle;
              var myGen = request.gen;
              var terrainSource = request.terrainSource;
              var skyConfig = request.skyConfig;
              var hillshadePaint = request.hillshadePaint;
              var gapBackground = request.gapBackground;
              // The pitch the frame is drawn at, which a turned camera changes.
              var drawnPitch = camera.pitch;
              ${HILLSHADE_INSERT_INDEX_SCRIPT}
          var hillshadeInsertCandidates = ${JSON.stringify(TERRAIN_3D_CONFIG.hillshadeInsertBeforeCandidates)};

              window._snapshotGen = myGen;
              window._tileErrorCount = 0;
              // The host pauses the whole pool on any throttle a render
              // reports, so a count carried over from an earlier render would
              // pause it again for a server that has since recovered.
              window._tileThrottleCount = 0;
              // A request is in flight from here until it posts its result.
              window._heartbeat.start();

              function isStale() {
                return window._snapshotGen !== myGen;
              }

              // Anything short of a complete picture ends here, and the host
              // retries it. A posted snapshot is saved as final.
              function postRenderError(error) {
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  phases: window._phases,
                  tileStats: window._tileStats,
                  type: 'snapshotError',
                  workerId: workerId,
                  activityId: activityId,
                  gen: myGen,
                  error: error,
                  tileErrors: window._tileErrorCount,
                  tileThrottles: window._tileThrottleCount,
                }));
              }

              window._rn_log('Snapshot ' + activityId + ' gen=' + myGen + ': ' + coords.length + ' coords, style=' + mapStyle + (isFlat ? ' (flat)' : ' (3d)'));

              function captureSnapshot() {
                if (isStale()) { window._rn_log('gen=' + myGen + ' superseded, aborting'); return; }
                phase('settle');
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
                      postRenderError('White tile detected');
                      return;
                    }
                  }

                  if (ctx && !isFlat) {
                    var pixel = new Uint8Array(4);
                    // A grid over the whole frame, since the far corner of a
                    // pitched view is where the last tiles land. Rows above the
                    // horizon are sky, so they are not sampled: the horizon
                    // sits (90 - pitch) degrees above the view's centre ray,
                    // and a margin below it covers the fog over far ground.
                    var fov = (window.map.transform && window.map.transform.fov) || 36.87;
                    var aboveCentre = 90 - drawnPitch;
                    var groundTop = 0;
                    if (aboveCentre < fov / 2) {
                      var rad = Math.PI / 180;
                      groundTop = h / 2 - (h / 2) * Math.tan(aboveCentre * rad) / Math.tan(fov / 2 * rad) + h * 0.05;
                    }
                    var gapCount = 0;
                    var sampled = 0;
                    for (var gc = 0; gc < 5; gc++) {
                      for (var gr = 0; gr < 4; gr++) {
                        var gx = Math.floor(w * (gc + 0.5) / 5);
                        var gyTop = Math.floor(h * (gr + 0.5) / 4);
                        if (gyTop < groundTop) continue;
                        sampled++;
                        ctx.readPixels(gx, h - gyTop - 1, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, pixel);
                        var r = pixel[0], g = pixel[1], b = pixel[2];
                        // Pure black is a failed terrain tile, in every style.
                        var isGap = r === 0 && g === 0 && b === 0;
                        if (!isGap && gapBackground) {
                          isGap = Math.abs(r - gapBackground[0]) <= ${BACKGROUND_TOLERANCE}
                            && Math.abs(g - gapBackground[1]) <= ${BACKGROUND_TOLERANCE}
                            && Math.abs(b - gapBackground[2]) <= ${BACKGROUND_TOLERANCE};
                        }
                        if (isGap) gapCount++;
                      }
                    }
                    if (gapCount >= 3) {
                      window._rn_log('Gap detected (' + gapCount + '/' + sampled + ' samples), rejecting');
                      postRenderError('Gap detected (' + gapCount + '/' + sampled + ')');
                      return;
                    }
                  }

                  // MapLibre counts a failed tile as loaded, so a render can
                  // finish with a hole in it. One counted tile error is enough
                  // to refuse the picture, wherever the hole falls.
                  if (window._tileErrorCount >= 1) {
                    window._rn_log('Tile errors detected (' + window._tileErrorCount + '), rejecting');
                    postRenderError('Tile errors: ' + window._tileErrorCount);
                    return;
                  }

                  phase('probe');
                  var dataUrl = canvas.toDataURL('image/jpeg', ${SNAPSHOT_JPEG_QUALITY});
                  var base64 = dataUrl.split(',')[1];
                  phase('encode');
                  window._rn_log('Captured ' + activityId + ' (' + Math.round(base64.length / 1024) + 'KB)');
                  window.ReactNativeWebView.postMessage(JSON.stringify({
                    type: 'snapshot',
                    workerId: workerId,
                    activityId: activityId,
                    mapStyle: mapStyle,
                    gen: myGen,
                    base64: base64,
                    tileErrors: window._tileErrorCount,
                    tileThrottles: window._tileThrottleCount,
                    // The host cannot tell a camera jump over a mounted style
                    // from a whole setStyle with its sources and its tiles,
                    // and they differ by an order of magnitude. The page knows
                    // which it took, so it says.
                    fastPath: window._renderPath === 'fast',
                    elapsed: window._renderStart ? Date.now() - window._renderStart : null,
                    // Where those milliseconds went, since the elapsed alone
                    // only says the render is the stage and not which part of
                    // it is the wait.
                    phases: window._phases,
                    tileStats: window._tileStats,
                  }));
                } catch(e) {
                  window._rn_log('Capture error: ' + e.message);
                  postRenderError(e.message);
                }
              }

              // A 3D render is checked once its style has loaded: when the
              // terrain hides the route the camera turns, and the capture
              // waits for the tiles the new view asks for, inside the same
              // deadline the render started with, which keeps it short of the
              // host's own timeout. A camera the athlete saved is theirs and
              // is never turned.
              function captureAfterCamera() {
                if (isStale()) return;
                var picked = camera;
                if (!isFlat && hasRoute && window._pickUnhiddenCamera && !cameraPinned) {
                  try {
                    picked = window._pickUnhiddenCamera(window.map, camera, coords, boundsSpans());
                  } catch (e) {
                    window._rn_log('Camera check failed: ' + e.message);
                  }
                }
                drawnPitch = picked.pitch;
                if (picked === camera) {
                  requestAnimationFrame(function() { setTimeout(captureSnapshot, 50); });
                  return;
                }
                window._rn_log('Terrain hides the route, turning to bearing ' + picked.bearing + ' pitch ' + picked.pitch);
                window.map.jumpTo({
                  center: picked.center, zoom: picked.zoom,
                  bearing: picked.bearing, pitch: picked.pitch,
                });
                var turnPoll = setInterval(function() {
                  if (isStale()) { clearInterval(turnPoll); clearTimeout(turnTimeout); return; }
                  if (window.map.isStyleLoaded()) {
                    clearInterval(turnPoll);
                    clearTimeout(turnTimeout);
                    requestAnimationFrame(function() { setTimeout(captureSnapshot, 50); });
                  }
                }, 200);
                var turnTimeout = setTimeout(function() {
                  clearInterval(turnPoll);
                  if (isStale()) return;
                  window._rn_log('Turned camera timeout (${RENDER_TIMEOUT_MS / 1000}s)');
                  postRenderError('Turned camera render timeout');
                }, Math.max(0, deadlineAt - Date.now()));
              }

              function boundsSpans() {
                var minLng = 180, maxLng = -180, minLat = 90, maxLat = -90;
                for (var bi = 0; bi < coords.length; bi++) {
                  minLng = Math.min(minLng, coords[bi][0]); maxLng = Math.max(maxLng, coords[bi][0]);
                  minLat = Math.min(minLat, coords[bi][1]); maxLat = Math.max(maxLat, coords[bi][1]);
                }
                return [maxLng - minLng, maxLat - minLat];
              }

              // --- Helper: add route sources + layers via map API ---
              // At IIFE scope so both fast path and full path can use it.
              var hasRoute = coords.length > 0;

              // The route on its casing and the end markers, in the request's base colours.
              function routeLayers() {
                return [
                  { id: 'route-outline', type: 'line', source: 'route',
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: routeCasingPaint },
                  { id: 'route-line', type: 'line', source: 'route',
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: { 'line-color': routeColor, 'line-width': routeLineWidth } },
                ].concat(endpointLayers);
              }

              function addRouteLayers() {
                if (!hasRoute) return;
                var startPt = coords[0];
                var endPt = coords[coords.length - 1];
                ${JSON.stringify([...ENDPOINT_3D_LAYER_IDS].reverse())}.forEach(function(id) {
                  try { window.map.removeLayer(id); } catch(e) {}
                });
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
                routeLayers().forEach(function(layer) { window.map.addLayer(layer); });
                window._rn_log('Route layers added via API');
              }

              // --- Fast path: same base style + mode, just update camera + route ---
              var baseMode = isFlat ? 'flat' : '3d';
              if (window._currentBaseStyle === mapStyle && window._currentBaseMode === baseMode && coords.length > 0) {
                if (isFlat || window.map.getSource('terrain')) {
                  window._renderPath = 'fast';
                  window.map.jumpTo({
                    center: camera.center, zoom: camera.zoom,
                    bearing: camera.bearing, pitch: camera.pitch,
                  });
                  // The fast path mounts no style, so its style stage is the
                  // jump alone. That it is near zero while the elapsed is not
                  // is the reading.
                  phase('style');
                  addRouteLayers();
                  window._rn_log('Fast path: camera and route ready, waiting for tiles...');
                  var done = false;
                  var fpStart = Date.now();

                  function fpCapture(reason) {
                    if (done || isStale()) return;
                    done = true;
                    clearInterval(fpPoll);
                    window._rn_log(reason);
                    captureAfterCamera();
                  }

                  // Let MapLibre queue the camera and route's tile requests first.
                  requestAnimationFrame(function() {
                    window.map.once('idle', function() {
                      fpCapture('Fast path idle, capturing...');
                    });
                  });

                  var fpPoll = setInterval(function() {
                    if (done || isStale()) { clearInterval(fpPoll); return; }
                    if (window.map.isStyleLoaded()) {
                      fpCapture('Fast path loaded after ' + (Date.now() - fpStart) + 'ms, capturing...');
                    }
                  }, 200);

                  setTimeout(function() {
                    clearInterval(fpPoll);
                    if (!done && !isStale()) {
                      done = true;
                      window._rn_log('Fast path timeout (${RENDER_TIMEOUT_MS / 1000}s)');
                      postRenderError('Fast path render timeout');
                    }
                  }, ${RENDER_TIMEOUT_MS});
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
                var hillshadeIdx = hillshadeInsertIndex(styleObj.layers, hillshadeInsertCandidates);
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

                routeLayers().forEach(function(layer) { styleObj.layers.push(layer); });
              }

              window._rn_log('setStyle (all-in-one): ' + styleObj.layers.length + ' layers, '
                + Object.keys(styleObj.sources).length + ' sources'
                + (styleObj.glyphs ? ', glyphs OK' : ', NO glyphs')
                + (styleObj.sprite ? ', sprite OK' : ', NO sprite'));
              ${setStyleStatement('window.map', 'styleObj')}
              window.map.jumpTo({
                center: camera.center,
                zoom: camera.zoom,
                bearing: camera.bearing,
                pitch: camera.pitch,
              });
              // Closes the style stage: the Liberty fetch for light mode, the
              // terrain, hillshade and route spliced in above, and the call
              // that mounts the lot.
              phase('style');

              // Wait for everything to load (DEM + vector + route tiles). A
              // render still loading at the deadline is not captured: it posts
              // an error below and the host retries it.
              var done = false;
              var setStyleTime = Date.now();

              var readyPoll = setInterval(function() {
                if (done || isStale()) { clearInterval(readyPoll); return; }
                var elapsed = Date.now() - setStyleTime;

                if (window.map.isStyleLoaded()) {
                  done = true;
                  clearInterval(readyPoll);
                  window._currentBaseStyle = mapStyle;
                  window._currentBaseMode = baseMode;
                  window._rn_log('All loaded after ' + elapsed + 'ms, capturing...');
                  captureAfterCamera();
                  return;
                }
              }, 200);

              // Hard timeout
              setTimeout(function() {
                clearInterval(readyPoll);
                if (!done && !isStale()) {
                  done = true;
                  window._rn_log('Hard timeout (${RENDER_TIMEOUT_MS / 1000}s), skipping');
                  postRenderError('Render timeout');
                }
              }, ${RENDER_TIMEOUT_MS});

              } // end applyStyle

              // A page that lost the style it was given says so, and the host
              // gives it again with the retry.
              var heldStyle = window._styles[mapStyle];
              if (typeof heldStyle !== 'string') {
                window._rn_log('Style ' + mapStyle + ' not held, asking for it');
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: 'snapshotError',
                  workerId: workerId,
                  activityId: activityId,
                  gen: myGen,
                  error: 'Style not held: ' + mapStyle,
                  styleMissing: true,
                }));
                return;
              }
              applyStyle(JSON.parse(heldStyle));

            } catch(e) {
              window._rn_log('Error: ' + e.message);
              if (window.ReactNativeWebView) {
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  phases: window._phases,
                  tileStats: window._tileStats,
                  type: 'snapshotError',
                  workerId: request.workerId,
                  activityId: request.activityId,
                  gen: request.gen,
                  error: e.message,
                }));
              }
            }
    };
  `;
}

/**
 * The script one snapshot request injects: the style, when the page does not
 * hold it, and the call to the page's render function. Derives the terrain,
 * sky and hillshade config from the request, and records in `held` that the
 * page holds the request's style from here on.
 */
export function buildRenderSnapshotScript(
  request: SnapshotRequest,
  workerId: number,
  gen: number,
  held: SnapshotStylesHeld = new Map()
): string {
  const isSatellite = request.mapStyle === 'satellite';
  const isDark = request.mapStyle === 'dark' || request.mapStyle === 'satellite';
  // The card previews a detail map, so it draws the base's subject colour.
  const palette = mapPalette(request.mapStyle);

  // Every style is an inline object, so the vector tiles, sprite and glyphs
  // all go through the interceptor and the page fetches no style.
  const { inline: style } = resolveStyleForWebView(request.mapStyle);
  const styleJSON = style ? JSON.stringify(style) : 'null';
  // Compared by content rather than by name, so a style that changed since the
  // page was given it is given again.
  const registration =
    held.get(request.mapStyle) === styleJSON
      ? ''
      : `window._styles[${jsLiteral(request.mapStyle)}] = ${jsLiteral(styleJSON)};\n`;
  held.set(request.mapStyle, styleJSON);

  const render = {
    workerId,
    gen,
    activityId: request.activityId,
    mapStyle: request.mapStyle,
    coords: request.coordinates,
    camera: request.camera,
    isSatellite,
    isDark,
    isFlat: request.flat === true,
    cameraPinned: request.cameraPinned === true,
    routeColor: palette.route,
    routeCasingPaint: routeCasing3DPaint(palette),
    routeLineWidth: ROUTE_3D_LINE_WIDTH,
    endpointLayers: endpoint3DLayers(palette),
    // Built here rather than read off the config, because building it is
    // what points it at the intercept and hands Rust the upstream template.
    terrainSource: terrain3DSource(),
    skyConfig: terrainSky(palette),
    hillshadePaint: terrainHillshadePaint(palette),
    gapBackground: gapBackgroundFor(request.mapStyle, style),
  };

  return `${registration}window._renderSnapshot(${JSON.stringify(render)});\ntrue;`;
}
