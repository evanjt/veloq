/**
 * One place that turns a `MapStyleType` into something a WebView map can load.
 *
 * Every WebView surface used to inline its own copy of this decision, and they
 * had drifted: the dark style was vector-cached in one place and not in
 * another, and each site re-derived the light style URL. Callers now state the
 * difference through options instead of duplicating the branch.
 */
import {
  getCombinedSatelliteStyle,
  rewriteSatelliteUrls,
  rewriteVectorUrls,
  MAP_STYLE_URLS,
} from '@/features/maps/components/mapStyles';
import type { MapStyleType } from '@/features/maps/components/mapStyles';
import { DARK_MATTER_STYLE } from '@/features/maps/components/darkMatterStyle';

/** Hosted Liberty style. Used where MapLibre should resolve TileJSON itself. */
export const LIGHT_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

export interface WebViewStyleOptions {
  /**
   * Route vector tiles through the `cached-vector://` protocol. Off by default
   * because rewriting after a `setStyle` leaves features blank until the cache
   * warms, which only the initial page load can absorb.
   */
  cacheVectorTiles?: boolean;
  /**
   * Serve the bundled Liberty style inline instead of the hosted URL. The 2D
   * surfaces use the bundle so they match the styling the native path shipped
   * and so a cold map does not wait on a style fetch.
   */
  bundledLightStyle?: boolean;
}

/**
 * Either an inline style object to hand straight to MapLibre, or a URL for it
 * to fetch. Exactly one is set.
 */
export type ResolvedWebViewStyle = { inline: object; url: null } | { inline: null; url: string };

export function resolveStyleForWebView(
  style: MapStyleType,
  options: WebViewStyleOptions = {}
): ResolvedWebViewStyle {
  const { cacheVectorTiles = false, bundledLightStyle = false } = options;

  if (style === 'satellite') {
    return { inline: rewriteSatelliteUrls(getCombinedSatelliteStyle()), url: null };
  }

  if (style === 'dark') {
    const dark = cacheVectorTiles ? rewriteVectorUrls(DARK_MATTER_STYLE) : DARK_MATTER_STYLE;
    return { inline: dark, url: null };
  }

  if (bundledLightStyle) {
    const light = cacheVectorTiles ? rewriteVectorUrls(MAP_STYLE_URLS.light) : MAP_STYLE_URLS.light;
    return { inline: light, url: null };
  }

  return { inline: null, url: LIGHT_STYLE_URL };
}

/**
 * The same decision expressed for template interpolation: a JS expression that
 * evaluates to the style object, or `null` when the caller must fetch a URL.
 */
export function resolveStyleExpression(
  style: MapStyleType,
  options: WebViewStyleOptions = {}
): { styleJSON: string; url: string | null } {
  const resolved = resolveStyleForWebView(style, options);
  return resolved.inline
    ? { styleJSON: JSON.stringify(resolved.inline), url: null }
    : { styleJSON: 'null', url: resolved.url };
}
