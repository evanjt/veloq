/**
 * Camera rules for the section detail map.
 *
 * A short section fits into a very small bounding box, and letting the camera
 * fit it exactly zooms past street level where the tiles turn grainy. The map
 * therefore fits the bounds but refuses to go beyond `SECTION_MAP_MAX_ZOOM`.
 */
import { type LngLatBounds, type MapCameraSpec, type MapPadding } from '@/features/maps';

/** Street level. Past this the basemap has no more detail to show. */
export const SECTION_MAP_MAX_ZOOM = 16;

/** Room between the fitted geometry and the part of the map nothing covers, in pixels. */
export const SECTION_MAP_FIT_PADDING = 80;

/** Fractional padding applied to the bounds themselves before fitting. */
export const SECTION_MAP_BOUNDS_PADDING = 0.15;

export function sectionCameraSpec(
  bounds: LngLatBounds,
  padding: MapPadding = SECTION_MAP_FIT_PADDING
): MapCameraSpec {
  return { bounds, padding };
}
