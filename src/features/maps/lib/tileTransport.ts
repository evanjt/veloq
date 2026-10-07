/**
 * How basemap tiles reach the map page.
 *
 * The page asks for a URL on its own origin and the platform answers it from
 * the Rust-owned store, fetching and keeping the tile there on a miss: the
 * WebView's request interceptor on Android, a scheme handler on iOS. The page
 * keeps no tile cache of its own, so Rust is the one place a tile is sized,
 * evicted and pre-seeded.
 */
import { Platform } from 'react-native';

import { LIBERTY_SOURCES } from '@/features/maps/styles/liberty/sources';
import { TERRAIN_UPSTREAM_TEMPLATE } from './terrainTemplate';

/**
 * The scheme the iOS handler owns. Agreed with `VeloqTileScheme` in
 * `VeloqTileSchemeHandler.m`. Nothing else ties the two.
 */
export const VELOQ_TILE_SCHEME = 'veloq-tile';

/**
 * The origin every map page loads on, and so the origin its tile requests
 * share, which is what makes them same-origin and spares them a CORS
 * preflight on either platform.
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
 * Hand one source's upstream template to Rust and give back the URL the page
 * should ask for instead. Returns null when Rust cannot be reached, which is
 * the test bench, so the caller leaves the source on its upstream URL.
 *
 * `extension` is for a template that names no tile file, which is a TileJSON
 * url: Rust resolves the dated snapshot segment out of that document, so the
 * page never learns a tile path and has to state what the tiles are instead.
 */
export function nativeTileUrl(source: string, template: string, extension?: string): string | null {
  try {
    // Required lazily, not imported: `veloqrs` reaches the Turbo Module at
    // import time, and a style is built in tests and on web where that module
    // does not exist. Answering null there leaves the style on its handler.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { basemapStore } = require('veloqrs') as typeof import('veloqrs');
    basemapStore().setSourceTemplate(source, template);
  } catch {
    return null;
  }
  return `${nativeTilePrefix()}/${source}/{z}/{x}/{y}.${extension ?? extensionOf(template)}`;
}

/**
 * Where the page asks for a heatmap tile.
 *
 * The heatmap is drawn by Rust from local GPS rather than fetched, so there is
 * no upstream template to hand over: the interceptor reads the file the pass
 * wrote and answers a tile it has not drawn yet with a 404.
 */
export function nativeHeatmapTileUrl(): string {
  return `${nativeTilePrefix()}/heatmap/{z}/{x}/{y}.png`;
}

/**
 * Hand Rust the ground and terrain sources before any
 * map page exists.
 *
 * `nativeTileUrl` does this at style load, which is too late for the pre-seed:
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
