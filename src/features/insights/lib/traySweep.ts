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
