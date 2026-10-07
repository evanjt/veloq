/** Turn a map style into a WebView style with optional source routing. */
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
   * Route the basemap tiles through the tile store rather than straight at the
   * host: the intercept on Android and the scheme handler on iOS. On by default.
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
