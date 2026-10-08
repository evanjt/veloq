/**
 * Camera rule for the route grouping preview map.
 *
 * The routes drawn are the ones nearest the selected riding area, and an
 * athlete with rides in several regions has some of those far away. Framing
 * every route drawn opened the map on the whole world, where no line could be
 * read, so the camera frames only the routes that pass through the area.
 */
import type { LngLatBounds } from '@/features/maps';
import { previewAreaBounds, type PreviewAreaCentre } from './previewMapCamera';

interface BoundedRoute {
  bounds?: { minLat: number; maxLat: number; minLng: number; maxLng: number } | undefined;
}

/**
 * The box the grouping preview frames for an area: every route whose own box
 * meets the area's ~5 km bin, whole, or the bin itself when no route reaches
 * it. Null without an area.
 */
export function groupingAreaBounds(
  centre: PreviewAreaCentre | null,
  routes: readonly BoundedRoute[]
): LngLatBounds | null {
  const area = previewAreaBounds(centre);
  if (!area) return null;

  let framed: LngLatBounds | null = null;
  for (const { bounds } of routes) {
    if (!bounds) continue;
    const meets =
      bounds.minLng <= area.ne[0] &&
      bounds.maxLng >= area.sw[0] &&
      bounds.minLat <= area.ne[1] &&
      bounds.maxLat >= area.sw[1];
    if (!meets) continue;
    framed = framed
      ? {
          sw: [Math.min(framed.sw[0], bounds.minLng), Math.min(framed.sw[1], bounds.minLat)],
          ne: [Math.max(framed.ne[0], bounds.maxLng), Math.max(framed.ne[1], bounds.maxLat)],
        }
      : { sw: [bounds.minLng, bounds.minLat], ne: [bounds.maxLng, bounds.maxLat] };
  }
  return framed ?? area;
}
