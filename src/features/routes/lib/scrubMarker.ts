import type { MapPalette } from '@/theme';
import { featureCollection, pointFeature, type MapLayerSpec } from '@/features/maps';
import type { RoutePoint } from '@/types';
import { scrubCoordinate } from './scrubCoordinate';

/** The source the scrub marker is drawn from, declared on every render and empty when idle. */
export const SCRUB_SOURCE_ID = 'scrub-point';

/** The marker as the collection its source holds: one point while scrubbing, none otherwise. */
export function scrubMarkerCollection(point: RoutePoint | null): GeoJSON.FeatureCollection {
  return featureCollection(point ? [pointFeature([point.lng, point.lat])] : []);
}

/** The marker's two circles, the activity map's highlight in the same palette roles. */
export function buildScrubLayers(palette: MapPalette): MapLayerSpec[] {
  return [
    {
      id: 'scrub-border',
      type: 'circle',
      source: SCRUB_SOURCE_ID,
      paint: { 'circle-radius': 7, 'circle-color': palette.casing },
    },
    {
      id: 'scrub-fill',
      type: 'circle',
      source: SCRUB_SOURCE_ID,
      paint: { 'circle-radius': 5, 'circle-color': palette.ink },
    },
  ];
}

/**
 * Where the scrubbed distance falls on the map: along the emphasised lap's own trace, so the
 * marker sits where that attempt was, else along the section's line.
 */
export function scrubMarkerPoint({
  distanceM,
  lengthM,
  lapPoints,
  linePoints,
}: {
  distanceM: number | null;
  lengthM: number | undefined;
  lapPoints: readonly RoutePoint[] | undefined;
  linePoints: readonly RoutePoint[];
}): RoutePoint | null {
  if (distanceM === null || lengthM === undefined) return null;
  const trace = lapPoints && lapPoints.length > 1 ? lapPoints : linePoints;
  return scrubCoordinate(trace, distanceM, lengthM);
}
