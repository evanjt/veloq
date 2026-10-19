/**
 * Inline JavaScript snippets shared between WebView HTML builders
 * (`buildMapSurfaceHtml`, `buildMap3DHtml`, `buildSnapshotWorkerHtml`). Keeping them here as
 * string exports lets each builder compose its template from the same
 * primitives without runtime overhead or duplication.
 */

import { dropRetiredTileCachesScript } from '@/features/maps/lib/tileCacheBudget';
import { jsNumber } from '@/features/maps/lib/webViewLiterals';
import { mapPageBaseUrl } from '@/features/maps/lib/tileTransport';
import {
  MAPLIBRE_GL_CSS_FILE,
  MAPLIBRE_GL_JS_FILE,
} from '@/features/maps/assets/maplibreRenderer.generated';

/**
 * Bridges calls to `window._rn_log(msg)` to React Native via postMessage.
 * Receivers should handle `{ type: 'console', message: string }` messages.
 * Optionally also carries `workerId` when building worker-style WebViews.
 */
export function consoleBridgeScript(options: { workerId?: string } = {}): string {
  const workerField = options.workerId ? `, workerId: ${options.workerId}` : '';
  return `
    window._rn_log = function(msg) {
      try {
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'console',
            message: String(msg)${workerField}
          }));
        }
      } catch (e) {}
    };
  `;
}

/**
 * Drops the Cache API buckets earlier builds filled.
 *
 * Every tile, the sprite and the glyphs are asked for by URL and answered by
 * the platform interceptor, so the page keeps no cache of its own and
 * registers no protocol: the terrain DEM, the basemap, the heatmap and the
 * bundled assets all go through the intercept.
 */
export function tileProtocolsScript(): string {
  return `
${dropRetiredTileCachesScript()}
  `;
}

/**
 * Reports a page whose terrain has no elevation tiles.
 *
 * The renderer ships in the app but the DEM tiles do not, so an offline 3D
 * open draws a flat map that looks like broken 3D. Reported once, after the
 * page has settled, so the caller can drop terrain and say why.
 *
 * Deliveries and failures, not cache hits and misses: the DEM comes through
 * the intercept, so the page has no handler of its own on that path and reads
 * both off MapLibre's source events for the `terrain` source instead. A page
 * with failures and no deliveries has no terrain at all.
 *
 * Defines `window._veloqTerrainReport` with `reset()`, `watch(map)`,
 * `report()` and `reportOnceSettled(map)`, which reports a second after the
 * map next goes idle, since a DEM tile that fails after the first frames still
 * leaves a flat map.
 */
export function terrainReportScript(): string {
  return `
    window._veloqTerrainReport = (function() {
      var delivered = 0, failed = 0, sent = false;
      function report() {
        if (sent || delivered > 0 || failed === 0) return;
        sent = true;
        window._rn_log('sending terrainUnavailable - ' + failed + ' DEM tiles failed');
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'terrainUnavailable',
            reason: 'no terrain tiles: ' + failed + ' failed, none delivered'
          }));
        }
      }
      return {
        reset: function() { delivered = 0; failed = 0; sent = false; },
        watch: function(map) {
          map.on('sourcedata', function(e) {
            if (e.sourceId === 'terrain' && e.tile) delivered++;
          });
          map.on('error', function(e) {
            if (e.sourceId === 'terrain' && e.tile) failed++;
          });
        },
        report: report,
        reportOnceSettled: function(map) {
          map.once('idle', function() { setTimeout(report, 1000); });
        },
      };
    })();
  `;
}

/**
 * The least time between two warms of one source. A warm inside the tile
 * client's idle window costs the request and nothing else.
 */
export const TILE_HOST_WARM_INTERVAL_MS = 5000;

/**
 * Asks the loopback listener to open the connection to each source's tile host
 * when a pan starts.
 *
 * After a pause longer than the tile client keeps its connection, a pan's first
 * misses wait on a new handshake. `movestart` comes a couple of hundred
 * milliseconds before the first tile ask, so a warm sent then has the
 * connection open when the misses arrive. One goes to
 * `<shard origin>/<token>/<source>/warm` per source whose tiles the listener
 * serves, at most once per `TILE_HOST_WARM_INTERVAL_MS`, and its answer is
 * ignored. A page whose tiles name no listener, which is every iOS page, sends
 * nothing.
 *
 * Defines `window._veloqTileWarm` with `watch(map)`.
 */
export function tileHostWarmScript(): string {
  return `
    window._veloqTileWarm = (function() {
      var LISTENER_TILE = /^(http:\\/\\/127\\.0\\.0\\.1:\\d+)\\/([^\\/]+)\\/([^\\/]+)\\//;
      var lastWarm = {};
      function warm(map) {
        var style;
        try { style = map.getStyle(); } catch (e) { return; }
        var sources = (style && style.sources) || {};
        var now = Date.now();
        Object.keys(sources).forEach(function(id) {
          var tiles = sources[id] && sources[id].tiles;
          var listener = tiles && tiles.length ? LISTENER_TILE.exec(tiles[0]) : null;
          if (!listener) return;
          var source = listener[3];
          if (now - (lastWarm[source] || 0) < ${TILE_HOST_WARM_INTERVAL_MS}) return;
          lastWarm[source] = now;
          try {
            fetch(listener[1] + '/' + listener[2] + '/' + source + '/warm', { cache: 'no-store' })
              .catch(function() {});
          } catch (e) {}
        });
      }
      return {
        watch: function(map) {
          map.on('movestart', function() { warm(map); });
        },
      };
    })();
  `;
}

/**
 * Chooses the camera a 3D render is drawn from so the terrain does not cover
 * the route.
 *
 * Defines `window._pickUnhiddenCamera(map, camera, coords, spans)`. It places
 * the eye for a camera (centre on the terrain, the viewport's half height over
 * tan(fov / 2) pixels back along the view), walks the ray from it to up to 200
 * route points and counts a point hidden when the rendered terrain along the
 * ray rises 3 m above it. The ray is read outward from the point at distances
 * growing with the square of the step, so the first read is a 256th of the way
 * to the eye: the ground beside the road, a valley side or a slope the road
 * runs behind, is what hides it most often, and the ray is low there, while
 * near the eye it is high enough that only a wide mountain reaches it. `queryTerrainElevation` already includes the
 * exaggeration, so heights are compared as read. A point with no loaded DEM is
 * clear. The request camera stays at 5% hidden or less. Otherwise the least
 * hidden of its turns of 180, 90 and 270 degrees (centre moved 8% of the span
 * toward the new eye) and the request bearing at pitch 40 is returned, the
 * first listed winning a tie.
 */
export function terrainVisibilityScript(): string {
  return `
    window._pickUnhiddenCamera = function(map, camera, coords, spans) {
      var KEEP_BELOW = 0.05, CLEARANCE_M = 3, RAY_STEPS = 16, MAX_POINTS = 200;
      if (!map || !map.queryTerrainElevation || !map.transform || !coords || coords.length < 2) return camera;
      var rad = Math.PI / 180;
      var fov = (map.transform.fov || 36.87) * rad;
      var viewH = map.transform.height || 240;
      var centre0 = camera.center;
      var mPerDegLat = 111320;
      var mPerDegLng = 111320 * Math.cos(centre0[1] * rad);
      function height(lng, lat) {
        var e = map.queryTerrainElevation([lng, lat]);
        return typeof e === 'number' && isFinite(e) ? e : null;
      }
      var step = Math.max(1, Math.ceil(coords.length / MAX_POINTS));
      var pts = [];
      for (var i = 0; i < coords.length; i += step) {
        var ez = height(coords[i][0], coords[i][1]);
        pts.push({ lng: coords[i][0], lat: coords[i][1], z: ez === null ? 0 : ez });
      }
      function shift(bearing) {
        var b = bearing * rad;
        return [-Math.sin(b) * spans[0] * 0.08, -Math.cos(b) * spans[1] * 0.08];
      }
      function hidden(cam) {
        var mpp = 40075016.686 * Math.cos(cam.center[1] * rad) / (512 * Math.pow(2, cam.zoom));
        var dist = (viewH / 2) / Math.tan(fov / 2) * mpp;
        var pitch = cam.pitch * rad, bear = cam.bearing * rad;
        var cz = height(cam.center[0], cam.center[1]);
        var horiz = dist * Math.sin(pitch);
        var eye = {
          e: (cam.center[0] - centre0[0]) * mPerDegLng - Math.sin(bear) * horiz,
          n: (cam.center[1] - centre0[1]) * mPerDegLat - Math.cos(bear) * horiz,
          z: (cz === null ? 0 : cz) + dist * Math.cos(pitch)
        };
        var count = 0;
        for (var p = 0; p < pts.length; p++) {
          var pe = (pts[p].lng - centre0[0]) * mPerDegLng, pn = (pts[p].lat - centre0[1]) * mPerDegLat;
          for (var s = 1; s < RAY_STEPS; s++) {
            var t = 1 - (s / RAY_STEPS) * (s / RAY_STEPS);
            var te = eye.e + (pe - eye.e) * t, tn = eye.n + (pn - eye.n) * t;
            var terrain = height(centre0[0] + te / mPerDegLng, centre0[1] + tn / mPerDegLat);
            if (terrain !== null && terrain > eye.z + (pts[p].z - eye.z) * t + CLEARANCE_M) { count++; break; }
          }
        }
        return count / pts.length;
      }
      var bestHidden = hidden(camera);
      if (bestHidden <= KEEP_BELOW) return camera;
      var best = camera;
      var from = shift(camera.bearing);
      var turns = [180, 90, 270];
      var candidates = [];
      for (var k = 0; k < turns.length; k++) {
        var bearing = (camera.bearing + turns[k]) % 360;
        var to = shift(bearing);
        candidates.push({
          center: [camera.center[0] + to[0] - from[0], camera.center[1] + to[1] - from[1]],
          zoom: camera.zoom, bearing: bearing, pitch: camera.pitch
        });
      }
      candidates.push({ center: camera.center, zoom: camera.zoom, bearing: camera.bearing, pitch: 40 });
      for (var c = 0; c < candidates.length; c++) {
        var h = hidden(candidates[c]);
        if (h < bestHidden) { bestHidden = h; best = candidates[c]; }
      }
      return best;
    };
  `;
}

/**
 * The head meta a page names its revision in. Agreed with `PageRevision.META` on Android,
 * which reads it out of the HTML a mount sends and the page it holds.
 */
export const PAGE_REVISION_META = 'veloq-page-revision';

/**
 * Standard HTML head: MapLibre GL JS, inline CSS for full-bleed map.
 * `mapHeight` defaults to `100vh`; pass a pixel value for fixed-height workers.
 *
 * The renderer and its stylesheet ship in the app and are asked for on the
 * page's own origin, where the platform interceptor answers them out of the
 * bundle, so a device with no radio and a cold WebView HTTP cache still draws
 * a map, and no page string carries its own megabyte-sized copy. The script
 * is a plain blocking one, so every page script after it can use `maplibregl`.
 * This is the one place it happens, so all three page builders stay identical.
 * A page a held WebView can take over names its `revision`.
 */
export function mapLibreHead(
  options: { title?: string; mapHeight?: string; revision?: string } = {}
): string {
  const height = options.mapHeight ?? '100vh';
  const title = options.title ?? 'Map';
  const assets = `${mapPageBaseUrl()}veloq-asset/`;
  const revision =
    options.revision === undefined
      ? ''
      : `\n  <meta name="${PAGE_REVISION_META}" content="${options.revision}">`;
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">${revision}
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>${title}</title>
  <link rel="stylesheet" href="${assets}${MAPLIBRE_GL_CSS_FILE}">
  <script id="maplibre-gl" src="${assets}${MAPLIBRE_GL_JS_FILE}"></script>
  <style>
    body { margin: 0; padding: 0; overflow: hidden; }
    #map { width: 100vw; height: ${height}; }
  </style>
</head>`;
}

/**
 * The one statement every page swaps its style with. `map` and `style` are
 * page expressions.
 *
 * Terrain is cleared first. A swap to a style with another sprite or glyph
 * set builds a new style, which has no projection until it loads, and the
 * renderer goes on drawing the old terrain's depth pass against it in the
 * meantime and throws from inside its frame. A style that names `terrain`
 * turns it back on as it loads.
 */
export function setStyleStatement(map: string, style: string): string {
  return `if (${map}.getTerrain()) ${map}.setTerrain(null); ${map}.setStyle(${style});`;
}

/**
 * Tears the page's map down in place. `map.remove()` releases the GL context
 * and every texture; the page is reloaded before anything asks for it again.
 */
export function buildReleaseMapScript(): string {
  return `
    (function() {
      if (window.map) {
        try { window.map.remove(); } catch (e) {}
        window.map = null;
      }
    })();
    true;
  `;
}

/**
 * The page's copy of the system reduce-motion setting.
 *
 * The WebView reads the setting once at process start, and MapLibre reads its
 * `reduceMotion` option once at construction, so neither follows a change made
 * while the app runs. The page builders set this before the map is made and the
 * host injects it again on every change, and every scripted camera move reads
 * it through `motionDurationExpression` when it runs.
 */
export function setReduceMotionStatement(enabled: boolean): string {
  return `window._veloqReduceMotion = ${enabled === true};`;
}

/** Injects a changed reduce-motion setting into a page that is already up. */
export function buildSetReduceMotionScript(enabled: boolean): string {
  return `${setReduceMotionStatement(enabled)} true;`;
}

/**
 * A page-side expression for a camera move's duration: none while reduce
 * motion is on, `durationMs` otherwise. Read when the script runs, so a script
 * built before a change still honours it. Never pair it with `essential: true`,
 * which makes MapLibre animate regardless.
 */
export function motionDurationExpression(durationMs: number): string {
  return `(window._veloqReduceMotion ? 0 : ${jsNumber(durationMs, 0)})`;
}
