/**
 * The tracks a demo session still owes.
 *
 * A live library asks the engine, which answers from the census. Demo mode
 * pulls no census: the fixtures are seeded as bodies and nothing else, so the
 * feed cards typed from them say which activities carry a track.
 */

import type { ActivitySportMapping } from 'veloqrs';
import { present } from 'veloqrs/src/delegates/optional';
import { activityStartEpoch } from '@/shared/activity/streamWindow';
import type { FeedCard } from '@/types';

/** The fixture cards with a track that the engine holds none for. */
export function demoGpsCandidates(
  cards: readonly FeedCard[],
  storedIds: ReadonlySet<string>
): ActivitySportMapping[] {
  return cards
    .filter((c) => c.hasGps && !storedIds.has(c.id))
    .map((c) =>
      present({
        activityId: c.id,
        sportType: c.sportType || 'Ride',
        startDate: activityStartEpoch(c.startDateLocal),
      })
    );
}
