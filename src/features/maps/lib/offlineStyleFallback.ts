import type { MapStyleType } from '@/features/maps/components/mapStyles';

/**
 * Which style a surface actually draws, given what the athlete chose.
 *
 * Satellite imagery is never kept on the device, so with the radio off the
 * satellite style has nothing to draw and the map is a grey grid. The vector
 * basemap is kept, so offline it stands in. The athlete's choice is untouched:
 * this is read at render, not written back, so the imagery returns the moment
 * the connection does.
 */
export function offlineMapStyle(
  chosen: MapStyleType,
  isOnline: boolean,
  vectorFallback: MapStyleType
): MapStyleType {
  if (chosen !== 'satellite' || isOnline) return chosen;
  // A caller that hands its own theme through could otherwise fall back onto
  // the style it is falling back from.
  return vectorFallback === 'satellite' ? 'light' : vectorFallback;
}
