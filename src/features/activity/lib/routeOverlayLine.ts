/**
 * The line the activity's Routes tab draws over the map: the route's
 * representative, from the signature the detail read carries.
 *
 * The signature is the stored, simplified line of the representative activity,
 * so drawing it reads no series and downloads nothing.
 */
import { decodeCoords } from 'veloqrs/src/coords';
import type { LatLng } from '@/shared/geo/polyline';

export function routeOverlayLine(
  detail: { representativeSignature: ArrayBuffer } | null | undefined,
  activeTab: string
): LatLng[] | null {
  if (activeTab !== 'routes' || !detail) return null;
  const line = decodeCoords(detail.representativeSignature);
  return line.length > 0 ? line : null;
}
