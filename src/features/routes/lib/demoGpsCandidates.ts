/**
 * The tracks a demo session still owes.
 *
 * A live library asks the engine, which answers from the census. Demo mode
 * pulls no census: the fixtures are seeded as bodies and nothing else, so the
 * fixtures themselves say which activities carry a track.
 */

import type { ActivitySportMapping } from 'veloqrs';
import { present } from 'veloqrs/src/delegates/optional';
import { activityStartEpoch } from '@/shared/activity/streamWindow';
import type { Activity } from '@/types';

/** The fixture activities with a `latlng` stream that the engine holds no track for. */
export function demoGpsCandidates(
  activities: readonly Activity[],
  storedIds: ReadonlySet<string>
): ActivitySportMapping[] {
  return activities
    .filter((a) => a.stream_types?.includes('latlng') && !storedIds.has(a.id))
    .map((a) =>
      present({
        activityId: a.id,
        sportType: a.type || 'Ride',
        startDate: activityStartEpoch(a.start_date_local),
      })
    );
}
