import {
  paddedFit,
  type LngLatBounds,
  type MapCameraSpec,
  type MapEdgeInset,
} from '@/features/maps';

/** Room between the fitted route and the part of the map nothing covers, in pixels. */
export const ROUTE_MAP_FIT_PADDING = 40;

/** A route map fits its line to the visible part when it has an inset, and to a margin otherwise. */
export function routeCameraSpec(
  bounds: LngLatBounds,
  inset: MapEdgeInset | undefined
): MapCameraSpec {
  return inset ? paddedFit(bounds, inset) : { bounds, padding: ROUTE_MAP_FIT_PADDING };
}
