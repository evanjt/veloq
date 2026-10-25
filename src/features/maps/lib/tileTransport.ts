/**
 * How basemap tiles reach the map page.
 *
 * The page asks for a URL the platform answers from the Rust-owned store,
 * fetching and keeping the tile there on a miss. On Android that is the
 * engine's loopback listener, on several ports so the WebView's six
 * connections per host and port do not queue a pan, because the request
 * interceptor would hold a WebView thread while a miss is fetched. On iOS it is
 * a scheme handler on the page's own origin. The page keeps no tile cache of its
 * own, so Rust is the one place a tile is sized, evicted and pre-seeded.
 */
import { AppState, Platform } from 'react-native';

import { LIBERTY_SOURCES } from '@/features/maps/styles/liberty/sources';
import { TERRAIN_UPSTREAM_TEMPLATE } from './terrainTemplate';
import type { MapBase } from '@/theme';

/**
 * The scheme the iOS handler owns. Agreed with `VeloqTileScheme` in
 * `VeloqTileSchemeHandler.m`. Nothing else ties the two.
 */
export const VELOQ_TILE_SCHEME = 'veloq-tile';

/**
 * The origin every map page loads on, and so the origin its assets, geo and
 * heatmap requests share, and on iOS its basemap tiles too. On Android the
 * basemap tiles come from the loopback listener, which admits this origin by
 * CORS.
 *
 * Android intercepts an https url before it leaves the WebView, so the page
 * stays on https and the host is never resolved. `WKURLSchemeHandler` will not
 * claim https at all, and an https page cannot fetch a custom scheme, so on
 * iOS the page itself loads on the scheme the handler owns.
 */
export function mapPageBaseUrl(): string {
  return Platform.OS === 'ios' ? `${VELOQ_TILE_SCHEME}://map/` : 'https://veloq.fit/';
}

/** Where a tile path starts, on the page's own origin. */
function nativeTilePrefix(): string {
  return `${mapPageBaseUrl()}veloq-tile`;
}

/** The extension the store files a tile under, ignoring any query string. */
function extensionOf(template: string): string {
  const path = template.split(/[?#]/)[0];
  const dot = path.lastIndexOf('.');
  if (dot < 0) return 'bin';
  const ext = path.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,5}$/.test(ext) ? ext : 'bin';
}

/**
 * Where the page asks for one source's tiles on each platform, as a template
 * prefix ending in `<source>/`, or null when there is nowhere to ask.
 *
 * Android names one origin per port of the engine's listener, each with the
 * per-launch token as the first path segment, and MapLibre spreads a source's
 * tiles over them by `(x + y) % n`.
 */
function tilePrefixes(): string[] | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { basemapStore } = require('veloqrs') as typeof import('veloqrs');
  if (Platform.OS !== 'android') return [`${nativeTilePrefix()}/`];
  const listener = basemapStore().tileListener();
  if (!listener || listener.ports.length === 0) return null;
  return listener.ports.map((port) => `http://127.0.0.1:${port}/${listener.token}/`);
}

/**
 * Hand one source's upstream template to Rust and give back the URLs the page
 * should ask for instead, one per shard. Returns null when Rust cannot be
 * reached, which is the test bench, or when the Android listener could not be
 * bound, so the caller leaves the source on its upstream URL.
 *
 * `extension` is for a template that names no tile file, which is a TileJSON
 * url: Rust resolves the dated snapshot segment out of that document, so the
 * page never learns a tile path and has to state what the tiles are instead.
 */
export function nativeTileUrls(
  source: string,
  template: string,
  extension?: string
): string[] | null {
  let prefixes: string[] | null;
  try {
    // Required lazily, not imported: `veloqrs` reaches the Turbo Module at
    // import time, and a style is built in tests and on web where that module
    // does not exist. Answering null there leaves the style on its handler.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { basemapStore } = require('veloqrs') as typeof import('veloqrs');
    prefixes = tilePrefixes();
    if (!prefixes) return null;
    basemapStore().setSourceTemplate(source, template);
  } catch {
    return null;
  }
  const file = `{z}/{x}/{y}.${extension ?? extensionOf(template)}`;
  return prefixes.map((prefix) => `${prefix}${source}/${file}`);
}

/**
 * Ask the engine for its listener each time the app comes back to the
 * foreground on Android, which is what makes it probe its own ports and bind
 * again, on the same ports, any that the background took. A page already open
 * holds those URLs, so binding has to happen before it asks for its next tile.
 */
export function registerTileListenerResume(): () => void {
  if (Platform.OS !== 'android') return () => {};
  const foreground = AppState.addEventListener('change', (state) => {
    if (state !== 'active') return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { basemapStore } = require('veloqrs') as typeof import('veloqrs');
      basemapStore().tileListener();
    } catch {
      // No module here, which is the test bench. Nothing to bind.
    }
  });
  return () => foreground.remove();
}

/**
 * Where the page asks for a heatmap tile drawn over `base`.
 *
 * The heatmap is drawn by Rust from local GPS rather than fetched, so there is
 * no upstream template to hand over: the interceptor reads the file the pass
 * wrote, in the base's own heat steps, and answers a tile it has not drawn yet
 * with a 404.
 */
export function nativeHeatmapTileUrl(base: MapBase): string {
  return `${nativeTilePrefix()}/heatmap-${base}/{z}/{x}/{y}.png`;
}

/** What the engine answers GeoJSON for at a `veloq-geo` URL. */
export type NativeGeoKind = 'track' | 'route-lines';

/**
 * Where the page asks for GeoJSON the engine writes from what it stores, such
 * as one activity's line, so a source can name a URL rather than carry the
 * text.
 *
 * `revision` is a query string the engine ignores: a source whose data is the
 * same URL is not fetched again, so whatever replaces the stored data has to
 * move it.
 */
export function nativeGeoUrl(kind: NativeGeoKind, key: string, revision: number): string {
  return `${mapPageBaseUrl()}veloq-geo/${kind}/${encodeURIComponent(key)}?v=${revision}`;
}

/**
 * Hand Rust the ground and terrain sources before any
 * map page exists.
 *
 * `nativeTileUrls` does this at style load, which is too late for the pre-seed:
 * a fresh install can sync a library and lose the radio without a map ever
 * having been opened, and Rust cannot fetch ground it has no template for. The
 * keys are `LIBERTY_SOURCES`' own, so a rename there fails the build here
 * rather than leaving the pre-seed with a source it cannot name, and Rust knows
 * the same two under `GROUND_SOURCES` in `basemap/preseed.rs`.
 */
export function handOverGroundTemplates(): void {
  const vector: keyof typeof LIBERTY_SOURCES = 'openmaptiles';
  const ground: keyof typeof LIBERTY_SOURCES = 'ne2_shaded';
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { basemapStore } = require('veloqrs') as typeof import('veloqrs');
    const store = basemapStore();
    store.setSourceTemplate(vector, LIBERTY_SOURCES[vector].url);
    store.setSourceTemplate(ground, LIBERTY_SOURCES[ground].tiles[0]);
    store.setSourceTemplate('terrain', TERRAIN_UPSTREAM_TEMPLATE);
  } catch {
    // No module here, which is the web and the test bench. Nothing to seed.
  }
}
