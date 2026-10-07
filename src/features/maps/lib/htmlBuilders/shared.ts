/**
 * Inline JavaScript snippets shared between WebView HTML builders
 * (`buildMap3DHtml`, `buildSnapshotWorkerHtml`). Keeping them here as
 * string exports lets each builder compose its template from the same
 * primitives without runtime overhead or duplication.
 */

import { dropRetiredTileCachesScript } from '@/features/maps/lib/tileCacheBudget';
import { MAPLIBRE_GL_CSS, MAPLIBRE_GL_JS } from '@/features/maps/assets/maplibreRenderer.generated';

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
 * Chooses the camera a 3D render is drawn from so the terrain does not cover
 * the route.
 *
 * Defines `window._pickUnhiddenCamera(map, camera, coords, spans)`. It places
 * the eye for a camera (centre on the terrain, the viewport's half height over
 * tan(fov / 2) pixels back along the view), walks the ray from it to up to 200
 * route points and counts a point hidden when the rendered terrain along the
 * ray rises 3 m above it. `queryTerrainElevation` already includes the
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
            var t = s / RAY_STEPS;
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
 * Standard HTML head: MapLibre GL JS, inline CSS for full-bleed map.
 * `mapHeight` defaults to `100vh`; pass a pixel value for fixed-height workers.
 *
 * The renderer and its stylesheet are inlined from the app bundle rather than
 * pulled off a CDN, so a device with no radio and a cold WebView HTTP cache
 * still draws a map. This is the one place it
 * happens, so all three page builders stay identical.
 */
export function mapLibreHead(options: { title?: string; mapHeight?: string } = {}): string {
  const height = options.mapHeight ?? '100vh';
  const title = options.title ?? 'Map';
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>${title}</title>
  <script id="maplibre-gl">${MAPLIBRE_GL_JS}</script>
  <style>${MAPLIBRE_GL_CSS}</style>
  <style>
    body { margin: 0; padding: 0; overflow: hidden; }
    #map { width: 100vw; height: ${height}; }
  </style>
</head>`;
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
