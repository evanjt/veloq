import type { LatLngShort } from '@/shared/geo/distance';

/** A saved route near the fix, as the record screen draws and lists it. */
export interface NearbyRouteView {
  id: string;
  name: string;
  distanceMeters: number;
  /** The best counted time in seconds, null when no attempt has one. */
  bestTimeSeconds: number | null;
  points: LatLngShort[];
}
