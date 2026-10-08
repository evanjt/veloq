/**
 * Read activity streams from the engine, asking Rust for anything absent.
 *
 * Rust stores the intervals.icu response body untouched and parses it on the
 * read, so the series cross the bridge as float buffers and nothing is parsed
 * on the JavaScript thread. Streams are the largest payloads the API returns,
 * so the engine keeps a bounded cache rather than a full mirror.
 *
 * A miss is not the end of the read. Rust rebuilds latlng, altitude and time
 * from the points and times the activity ingest already stored, so a map
 * preview costs nothing over the wire however long ago the body aged out. A
 * selection it cannot serve whole, the detail set among them, still reads as
 * absent and is re-requested: a partial body would look stocked and cost the
 * athlete their power and heart rate. An activity with no track has nothing
 * to rebuild from, and its selection is answered from the series stored in
 * the server's own sample index, which hold everything upstream had for it.
 */

import { streamsFromBuffers } from '@/features/activity/lib/streams';
import { useAuthStore } from '@/shared/app/AuthStore';
import { getEngine } from '@/shared/native/engine';
import type { ActivityStreams } from '@/types';
import type { StartOutcome, StartResult } from 'veloqrs';

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
 * exact string, so the read and the request have to agree on it. Sorting
 * makes it canonical, which is what `stream_bodies.types` documents: two call
 * sites naming the same series in a different order must not each pay for a
 * 100-500KB download and then evict one another.
 */
export function streamTypesKey(types: readonly string[]): string {
  return [...types].sort().join(',');
}

/** Streams read from the stored body, or null when nothing is stored. */
export function readStreams(activityId: string, types: readonly string[]): ActivityStreams | null {
  const engine = getEngine();
  if (!engine?.getActivityStreams || !activityId) return null;

  const buffers = engine.getActivityStreams(activityId, streamTypesKey(types));
  if (!buffers) return demoStreams(activityId);
  return streamsFromBuffers(buffers);
}

/**
 * Demo streams straight from the generator, or null outside demo mode.
 *
 * The engine's stream store is a bounded LRU sized for one user's recent
 * activities, far smaller than the demo fixture set. Seeding every fixture
 * would only evict itself, so demo reads fall through to the generator, which
 * is deterministic per activity id and needs no network.
 */
function demoStreams(activityId: string): ActivityStreams | null {
  if (!useAuthStore.getState().isDemoMode) return null;
  const { getActivityStreams } =
    require('@/shared/demo/activity') as typeof import('@/shared/demo/activity');
  return (getActivityStreams(activityId) as ActivityStreams | null) ?? null;
}

/** Ask Rust to fetch and store a series selection for an activity. */
export function requestStreams(
  activityId: string,
  types: readonly string[]
): StartOutcome | StartResult | undefined {
  if (!activityId) return undefined;
  // Demo mode has no account to fetch against, the generator answers instead.
  if (useAuthStore.getState().isDemoMode) return undefined;
  return getEngine()?.syncActivityStreams(activityId, streamTypesKey(types));
}
