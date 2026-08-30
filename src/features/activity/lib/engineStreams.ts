/**
 * Read activity streams from the engine, asking Rust for anything absent.
 *
 * Rust stores the intervals.icu response body untouched and `parseStreams`
 * stays the single transform, so what the charts render is what they rendered
 * when the fetch lived in axios. Streams are the largest payloads the API
 * returns, so the engine keeps a bounded cache rather than a full mirror.
 *
 * A miss is not the end of the read. Rust rebuilds latlng, altitude and time
 * from the points and times the activity ingest already stored, so a map
 * preview costs nothing over the wire however long ago the body aged out. A
 * selection it cannot serve whole, the detail set among them, still reads as
 * absent and is re-requested: a partial body would look stocked and cost the
 * athlete their power and heart rate.
 */

import { parseStreams } from "@/features/activity/lib/streams";
import { useAuthStore } from "@/shared/app/AuthStore";
import { getRouteEngine } from "@/shared/native/routeEngine";
import type { ActivityStreams, RawStreamItem } from "@/types";

/** The full series set the detail charts render. */
export const DETAIL_STREAM_TYPES = [
  "latlng",
  "altitude",
  "fixed_altitude",
  "heartrate",
  "watts",
  "cadence",
  "distance",
  "time",
  "velocity_smooth",
  "grade_smooth",
  "temp",
  "w_bal",
  "ga_velocity",
] as const;

/** The two series a static map preview needs. */
export const PREVIEW_STREAM_TYPES = ["latlng", "altitude"] as const;

/**
 * The cache key for a series selection. Rust keys the stored body on this
 * exact string, so the read and the request have to agree on it. Sorting
 * makes it canonical, which is what `stream_bodies.types` documents: two call
 * sites naming the same series in a different order must not each pay for a
 * 100-500KB download and then evict one another.
 */
export function streamTypesKey(types: readonly string[]): string {
  return [...types].sort().join(",");
}

/** Streams parsed from the stored body, or null when nothing is stored. */
export function readStreams(
  activityId: string,
  types: readonly string[],
): ActivityStreams | null {
  const engine = getRouteEngine();
  if (!engine?.getStreamBody || !activityId) return null;

  const body = engine.getStreamBody(activityId, streamTypesKey(types));
  if (!body) return demoStreams(activityId);
  try {
    const parsed = JSON.parse(body);
    // A live fetch stores the intervals.icu array untouched.
    return Array.isArray(parsed)
      ? parseStreams(parsed as RawStreamItem[])
      : (parsed as ActivityStreams);
  } catch {
    // A body we cannot parse is a corrupt row, not an activity with no streams.
    return null;
  }
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
    require("@/features/activity/demo") as typeof import("@/features/activity/demo");
  return (getActivityStreams(activityId) as ActivityStreams | null) ?? null;
}

/** Ask Rust to fetch and store a series selection for an activity. */
export function requestStreams(
  activityId: string,
  types: readonly string[],
): void {
  if (!activityId) return;
  // Demo mode has no account to fetch against, the generator answers instead.
  if (useAuthStore.getState().isDemoMode) return;
  getRouteEngine()?.syncActivityStreams(activityId, streamTypesKey(types));
}
