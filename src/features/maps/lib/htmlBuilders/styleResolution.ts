/**
 * One place that turns a `MapStyleType` into something a WebView map can load.
 * Callers state their difference through options rather than branching
 * themselves, so the dark style's vector cache and the light style URL are
 * decided once.
 *
 * The defaults are what the seven 2D surfaces want, so they state nothing. The
 * three 3D paths pass `TERRAIN_STYLE_OPTIONS`, which is the only opt-out.
 */
import {
  getCombinedSatelliteStyle,
  rewriteSatelliteUrls,
  rewriteVectorUrls,
  rewriteGroundRasterUrls,
  rewriteBundledAssets,
  MAP_STYLE_URLS,
} from '@/features/maps/components/mapStyles';
import type { MapStyleType } from '@/features/maps/components/mapStyles';
import { DARK_MATTER_STYLE } from '@/features/maps/components/darkMatterStyle';

/** Hosted Liberty style. Used where MapLibre should resolve TileJSON itself. */
export const LIGHT_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

export interface WebViewStyleOptions {
  /**
   * Route the basemap tiles through the `cached-vector://` and `cached-ground://`
   * protocols. On by default: every 2D surface wants it, and rewriting after a
   * `setStyle` is what the 3D paths avoid, since it leaves features blank until
   * the cache warms.
   */
  cacheVectorTiles?: boolean;
  /**
   * Serve the bundled Liberty style inline instead of the hosted URL. On by
   * default so the 2D surfaces match the styling the native path shipped and a
   * cold map does not wait on a style fetch.
   */
  bundledLightStyle?: boolean;
  /**
   * Serve the sprite and the Latin glyph ranges out of the app bundle. On by
   * default. Off for a page that does not register the `bundled` protocol,
   * which is the snapshot worker, where the request would go unanswered.
   */
  bundledAssets?: boolean;
}

/**
 * The 3D surfaces opt out of both. They load a style once on a cold page and
 * let MapLibre resolve the light TileJSON itself, so neither the bundle nor the
 * cached protocol buys them anything, and the rewrite costs them blank features
 * after a style swap. `map3D` keeps the cached protocol, it builds its page
 * fresh each time.
 */
export const TERRAIN_STYLE_OPTIONS: WebViewStyleOptions = {
  bundledLightStyle: false,
  cacheVectorTiles: false,
};

/**
 * Either an inline style object to hand straight to MapLibre, or a URL for it
 * to fetch. Exactly one is set.
 */
export type ResolvedWebViewStyle = { inline: object; url: null } | { inline: null; url: string };

export function resolveStyleForWebView(
  style: MapStyleType,
  options: WebViewStyleOptions = {}
): ResolvedWebViewStyle {
  const { cacheVectorTiles = true, bundledLightStyle = true, bundledAssets = true } = options;
  const withAssets = <T extends object>(s: T): T => (bundledAssets ? rewriteBundledAssets(s) : s);

  if (style === 'satellite') {
    return { inline: withAssets(rewriteSatelliteUrls(getCombinedSatelliteStyle())), url: null };
  }

  if (style === 'dark') {
    const dark = cacheVectorTiles ? rewriteVectorUrls(DARK_MATTER_STYLE) : DARK_MATTER_STYLE;
    return { inline: withAssets(dark), url: null };
  }

  if (bundledLightStyle) {
    const light = cacheVectorTiles
      ? rewriteGroundRasterUrls(rewriteVectorUrls(MAP_STYLE_URLS.light))
      : MAP_STYLE_URLS.light;
    return { inline: withAssets(light), url: null };
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
