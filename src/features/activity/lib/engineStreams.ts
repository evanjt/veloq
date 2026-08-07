/**
 * Read activity streams from the engine, asking Rust for anything absent.
 *
 * Rust stores the intervals.icu response body untouched and `parseStreams`
 * stays the single transform, so what the charts render is what they rendered
 * when the fetch lived in axios. Streams are the largest payloads the API
 * returns, so the engine keeps a bounded cache rather than a full mirror: a
 * body that has aged out simply reads as absent and is re-requested.
 */

import { parseStreams } from '@/features/activity/lib/streams';
import { getRouteEngine } from '@/shared/native/routeEngine';
import type { ActivityStreams, RawStreamItem } from '@/types';

/** The full series set the detail charts render. */
export const DETAIL_STREAM_TYPES = [
  'latlng',
  'altitude',
  'fixed_altitude',
  'heartrate',
  'watts',
  'cadence',
  'distance',
  'time',
  'velocity_smooth',
  'grade_smooth',
  'temp',
  'w_bal',
  'ga_velocity',
] as const;

/** The two series a static map preview needs. */
export const PREVIEW_STREAM_TYPES = ['latlng', 'altitude'] as const;

/**
 * The cache key for a series selection. Rust keys the stored body on this
 * exact string, so the read and the request have to agree on it.
 */
export function streamTypesKey(types: readonly string[]): string {
  return types.join(',');
}

/** Streams parsed from the stored body, or null when nothing is stored. */
export function readStreams(activityId: string, types: readonly string[]): ActivityStreams | null {
  const engine = getRouteEngine();
  if (!engine?.getStreamBody || !activityId) return null;

  const body = engine.getStreamBody(activityId, streamTypesKey(types));
  if (!body) return null;
  try {
    const parsed = JSON.parse(body);
    // A live fetch stores the intervals.icu array untouched. The demo seed
    // stores the already-parsed object, because the fixtures generate that
    // shape directly rather than the wire format.
    return Array.isArray(parsed)
      ? parseStreams(parsed as RawStreamItem[])
      : (parsed as ActivityStreams);
  } catch {
    // A body we cannot parse is a corrupt row, not an activity with no streams.
    return null;
  }
}

/** Ask Rust to fetch and store a series selection for an activity. */
export function requestStreams(activityId: string, types: readonly string[]): void {
  if (!activityId) return;
  getRouteEngine()?.syncActivityStreams(activityId, streamTypesKey(types));
}
