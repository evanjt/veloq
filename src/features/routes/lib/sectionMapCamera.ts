/**
 * Camera rules for the section detail map.
 *
 * A short section fits into a very small bounding box, and letting the camera
 * fit it exactly zooms past street level where the tiles turn grainy. The map
 * therefore fits the bounds but refuses to go beyond `SECTION_MAP_MAX_ZOOM`.
 */
import type { MapCameraSpec } from '@/features/maps/lib/htmlBuilders';
import type { LngLatBounds } from '@/features/maps/lib/coordinates';

/** Street level. Past this the basemap has no more detail to show. */
export const SECTION_MAP_MAX_ZOOM = 16;

/** Room around the fitted geometry, in pixels, so controls do not cover it. */
export const SECTION_MAP_FIT_PADDING = 80;

/** Fractional padding applied to the bounds themselves before fitting. */
export const SECTION_MAP_BOUNDS_PADDING = 0.15;

export function sectionCameraSpec(bounds: LngLatBounds): MapCameraSpec {
  return { bounds, padding: SECTION_MAP_FIT_PADDING };
}
