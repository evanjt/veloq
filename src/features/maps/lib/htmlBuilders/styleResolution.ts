import {
  getCombinedSatelliteStyle,
  rewriteSatelliteUrls,
  rewriteVectorUrls,
  rewriteGroundRasterUrls,
  rewriteBundledAssets,
} from '@/features/maps/components/mapStyles';
import type { MapStyleType } from '@/features/maps/components/mapStyles';
import { upstreamStyle } from './upstreamStyle';

/**
 * Turn a map style into the inline style object handed to MapLibre: basemap
 * tiles routed through the tile store (the intercept on Android, the scheme
 * handler on iOS), and the sprite and Latin glyph ranges served out of the
 * app bundle.
 */
export function resolveStyleForWebView(style: MapStyleType): { inline: object } {
  if (style === 'satellite') {
    return { inline: rewriteBundledAssets(rewriteSatelliteUrls(getCombinedSatelliteStyle())) };
  }

  if (style === 'dark') {
    return { inline: rewriteBundledAssets(rewriteVectorUrls(upstreamStyle('dark'))) };
  }

  return {
    inline: rewriteBundledAssets(
      rewriteGroundRasterUrls(rewriteVectorUrls(upstreamStyle('light')))
    ),
  };
}

/** The resolved style as JSON for template interpolation. */
export function resolveStyleExpression(style: MapStyleType): string {
  return JSON.stringify(resolveStyleForWebView(style).inline);
}
