import { haversineDistance } from '@/shared/geo/distance';
import type { RoutePoint } from '@/types';

/**
 * The point a trace reaches `distanceM` into a section of `lengthM`. The trace may be longer or
 * shorter than the section, so the distance is placed by its share of the section's length along
 * the trace's own length. A distance outside the section is held to the trace's ends.
 */
export function scrubCoordinate(
  points: readonly RoutePoint[],
  distanceM: number,
  lengthM: number
): RoutePoint | null {
  const first = points[0];
  if (first === undefined || !Number.isFinite(distanceM) || !(lengthM > 0)) return null;
  if (points.length === 1) return first;

  const cumulative: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as RoutePoint;
    const b = points[i] as RoutePoint;
    cumulative.push((cumulative[i - 1] as number) + haversineDistance(a.lat, a.lng, b.lat, b.lng));
  }
  const total = cumulative[cumulative.length - 1] as number;
  if (!(total > 0)) return first;

  const target = Math.min(Math.max(distanceM / lengthM, 0), 1) * total;
  let i = 1;
  while (i < points.length - 1 && (cumulative[i] as number) < target) i++;
  const from = points[i - 1] as RoutePoint;
  const to = points[i] as RoutePoint;
  const legStart = cumulative[i - 1] as number;
  const leg = (cumulative[i] as number) - legStart;
  if (!(leg > 0)) return from;
  const t = (target - legStart) / leg;
  return { lat: from.lat + (to.lat - from.lat) * t, lng: from.lng + (to.lng - from.lng) * t };
}
