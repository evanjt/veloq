/**
 * How basemap raster tiles reach the map page.
 *
 * Two transports exist side by side so one build can be measured both ways.
 * `cached-satellite://` is the page's own protocol handler, which fetches over
 * the network and keeps the bytes in a per-origin Cache API bucket Rust cannot
 * see. The native transport asks for an ordinary URL the WebView's request
 * interceptor answers from the Rust-owned store, fetching and keeping the tile
 * there on a miss.
 */

/**
 * Off until the request interceptor ships. With no interceptor every tile URL
 * would leave the WebView and resolve nothing, so the map would draw nothing.
 */
export const NATIVE_TILE_TRANSPORT = false;

/**
 * Intercepted before it leaves the WebView, so the host is never resolved.
 * It shares the page's own origin so the request is same-origin and needs no
 * CORS preflight.
 */
const NATIVE_TILE_PREFIX = 'https://veloq.fit/veloq-tile';

/** The extension the store files a tile under, ignoring any query string. */
function extensionOf(template: string): string {
  const path = template.split(/[?#]/)[0];
  const dot = path.lastIndexOf('.');
  if (dot < 0) return 'bin';
  const ext = path.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,5}$/.test(ext) ? ext : 'bin';
}

/**
 * Hand one source's upstream template to Rust and give back the URL the page
 * should ask for instead. Returns null when the store is unreachable, so the
 * caller can leave the style on its existing transport rather than draw
 * nothing.
 */
export function nativeTileUrl(source: string, template: string): string | null {
  try {
    // Required lazily, not imported: `veloqrs` reaches the Turbo Module at
    // import time, and a style is built in tests and on web where that module
    // does not exist. The transport is off in both.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { basemapStore } = require('veloqrs') as typeof import('veloqrs');
    basemapStore().setSourceTemplate(source, template);
  } catch {
    return null;
  }
  return `${NATIVE_TILE_PREFIX}/${source}/{z}/{x}/{y}.${extensionOf(template)}`;
}
