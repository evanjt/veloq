/**
 * Camera framing for the regional map.
 *
 * The bottom inset is generous because the timeline slider, filter chips and
 * the activity popup all stack along the bottom edge.
 */
import type { MapPadding } from '@/features/maps/lib/htmlBuilders';

export const REGIONAL_FIT_PADDING: MapPadding = {
  top: 100,
  right: 60,
  bottom: 280,
  left: 60,
};
