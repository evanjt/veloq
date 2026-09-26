/**
 * Which activity traces the regional map sends to the page, and when.
 *
 * A trace is about fifty coordinate pairs, so a 490-activity library is roughly
 * 0.7 MB of JSON stringified, injected into the WebView and tiled by MapLibre.
 * That went up on every map mount and again on every `activities` event, at
 * world zoom, where no trace is drawn: the layer starts at
 * `TRACE_ZOOM_THRESHOLD`.
 *
 * Two gates, and the zoom one does the work. Below the threshold there is
 * nothing to send at all. Above it the payload is culled to what the camera
 * holds, at every library size rather than only past the clustering threshold,
 * because a trace outside the viewport is as invisible as one below the zoom.
 */

export interface TraceBudgetInput<T> {
  /** Everything the filters left, in the order the page draws it. */
  activities: T[];
  /** Ids the camera currently holds, or null before the first region change. */
  visibleIds: Set<string> | null;
  /** The settled zoom, or null before the camera has reported one. */
  zoom: number | null;
  /** The zoom the trace layer starts drawing at. */
  threshold: number;
  id: (activity: T) => string;
}

/**
 * The activities whose traces are worth sending.
 *
 * Empty below the threshold. A null zoom counts as below it: the camera has not
 * reported yet, the opening frame is the one being paid for, and the first
 * region change arrives immediately after.
 */
export function traceSubjects<T>(input: TraceBudgetInput<T>): T[] {
  const { activities, visibleIds, zoom, threshold, id } = input;
  if (zoom === null || zoom < threshold) return [];
  if (!visibleIds) return activities;
  return activities.filter((activity) => visibleIds.has(id(activity)));
}
