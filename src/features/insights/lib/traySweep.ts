/**
 * Which tray entries the enriched activity notification replaces.
 *
 * The sweep used to dismiss anything without an `activityId`, meaning to catch
 * the FCM-posted visible push. It caught the sticky sync banner, which carries
 * no data at all, and every insight routed by section or by route (`B145`).
 *
 * So the rule is now positive: dismiss what this notification is replacing and
 * leave anything else alone, including anything unrecognised. A stale tray
 * entry is noise; a dismissed sync banner is a sync running with no visible
 * progress until the next update reposts it.
 */

import { tapTargetFromPushData } from './pushPayload';

export function shouldDismissForActivity(
  identifier: string,
  data: unknown,
  activityId: string
): boolean {
  if (identifier === `activity-${activityId}`) return true;
  return tapTargetFromPushData(data)?.path === `/activity/${activityId}`;
}

/** One entry as the tray reports it: its identifier and its push payload. */
export interface TrayEntry {
  identifier: string;
  data: unknown;
}

export interface TrayReplacement {
  activityId: string;
  /** The tray as it stands. Read before the post, so the fresh entry is not in it. */
  listPresented: () => Promise<TrayEntry[]>;
  /**
   * Posts the enriched entry under `activity-<id>`. Null when there is nothing
   * to post, which is the foreground case: the athlete is on the activity and a
   * tray entry is noise, so the old entries still come down.
   */
  present: (() => Promise<void>) | null;
  dismiss: (identifier: string) => Promise<void>;
}

/**
 * Put the enriched entry up, then take down what it replaced. Returns whether
 * it was posted.
 *
 * The order is the point. These were sequential awaits the other way round,
 * with nothing tying them together, so an OEM battery kill or an expiring iOS
 * extension budget between the two left the athlete with an empty tray and no
 * record the activity had arrived (`B147`). A post that fails dismisses
 * nothing, which leaves the generic entry standing rather than replacing it
 * with silence.
 *
 * `activity-<id>` is never dismissed after a successful post: the post replaces
 * it in place under the same identifier, so dismissing it would take down the
 * entry that was just written.
 */
export async function replaceActivityTrayEntry(r: TrayReplacement): Promise<boolean> {
  let presented: TrayEntry[] = [];
  try {
    presented = await r.listPresented();
  } catch {
    // A tray that cannot be read is not a reason to withhold the notification.
    presented = [];
  }

  let posted = false;
  if (r.present) {
    try {
      await r.present();
      posted = true;
    } catch {
      return false;
    }
  }

  for (const entry of presented) {
    if (posted && entry.identifier === `activity-${r.activityId}`) continue;
    if (!shouldDismissForActivity(entry.identifier, entry.data, r.activityId)) continue;
    try {
      await r.dismiss(entry.identifier);
    } catch {
      // One entry the OS has already cleared must not strand the others.
    }
  }

  return posted;
}

/**
 * What the task should do with the tray once the body is built.
 *
 * `leave` is the outcome that was missing. `fetchAndIngestActivity` returns
 * null on three paths, the body then had nothing in it but the notification's
 * own title, and reposting that over the generic entry the push already put up
 * made the failure path produce a worse notification than doing nothing
 * (`B149`).
 */
export function trayActionFor(
  body: string,
  foreground: boolean
): 'post' | 'dismiss-only' | 'leave' {
  if (!body.trim()) return 'leave';
  return foreground ? 'dismiss-only' : 'post';
}
