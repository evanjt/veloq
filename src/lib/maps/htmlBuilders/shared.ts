/**
 * Inline JavaScript snippets shared between WebView HTML builders
 * (`buildMap3DHtml`, `buildSnapshotWorkerHtml`). Keeping them here as
 * string exports lets each builder compose its template from the same
 * primitives without runtime overhead or duplication.
 */

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
 * Standard HTML head: MapLibre GL JS, inline CSS for full-bleed map.
 * `mapHeight` defaults to `100vh`; pass a pixel value for fixed-height workers.
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
  <script src="https://unpkg.com/maplibre-gl@5.19.0/dist/maplibre-gl.js"></script>
  <link href="https://unpkg.com/maplibre-gl@5.19.0/dist/maplibre-gl.css" rel="stylesheet" />
  <style>
    body { margin: 0; padding: 0; overflow: hidden; }
    #map { width: 100vw; height: ${height}; }
  </style>
</head>`;
}
