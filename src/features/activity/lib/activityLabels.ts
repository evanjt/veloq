import { readActivityBody } from '@/features/activity/lib/engineActivityBody';
import { formatLocalDate } from '@/shared/format/format';

/** What a row needs to name the activity a best was set on. */
export interface ActivityLabel {
  name: string;
  date: string;
}

/**
 * The name and day of each of `ids`.
 *
 * One primary-key read per id, and each id read once however many rows it
 * labels. The window read this replaced returned every body in the requested
 * range and parsed all of them, which on the all-time toggle is ten years of
 * library to name at most fourteen rows.
 *
 * An id with no stored body is left out rather than given an empty label. The
 * caller shows "not cached" for a best whose activity is outside what the
 * device holds, and a label with no name would read as a cached one.
 */
export function activityLabels(ids: readonly string[]): Map<string, ActivityLabel> {
  const out = new Map<string, ActivityLabel>();
  for (const id of ids) {
    if (!id || out.has(id)) continue;
    const activity = readActivityBody(id);
    if (!activity) continue;
    out.set(id, {
      name: activity.name,
      date: activity.start_date_local ? formatLocalDate(new Date(activity.start_date_local)) : '',
    });
  }
  return out;
}
