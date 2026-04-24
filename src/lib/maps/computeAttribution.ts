/**
 * computeAttribution — pure attribution text computation for map contexts.
 *
 * Combines the style-specific attribution with dynamic satellite-source
 * attribution (when `style === 'satellite'` and a viewport is known) and
 * optional terrain attribution for 3D mode.
 *
 * Extracted from ActivityMapView.tsx for reuse and testability.
 */

import {
  MAP_ATTRIBUTIONS,
  TERRAIN_ATTRIBUTION,
  getCombinedSatelliteAttribution,
  type MapStyleType,
} from '@/components/maps/mapStyles';

export interface ComputeAttributionArgs {
  style: MapStyleType;
  is3D: boolean;
  /** Current viewport center in [lng, lat] format. Only used for satellite style. */
  center: [number, number] | null;
  /** Current viewport zoom level. Only used for satellite style. */
  zoom: number;
}

/**
 * Compute the combined attribution text for a given map style and viewport.
 *
 * For `satellite` with a known `center`, returns the dynamic combined
 * satellite attribution (which sources are visible in the viewport). For
 * other styles, returns the base attribution for that style. When `is3D` is
 * true, appends the terrain source attribution.
 */
export function computeAttribution({ style, is3D, center, zoom }: ComputeAttributionArgs): string {
  if (style === 'satellite' && center) {
    const satAttribution = getCombinedSatelliteAttribution(
      center[1], // lat
      center[0], // lng
      zoom
    );
    return is3D ? `${satAttribution} | ${TERRAIN_ATTRIBUTION}` : satAttribution;
  }
  const baseAttribution = MAP_ATTRIBUTIONS[style];
  return is3D ? `${baseAttribution} | ${TERRAIN_ATTRIBUTION}` : baseAttribution;
}
