import { useEffect } from 'react';

import { activities } from 'veloqrs';
import { getEngine } from '@/shared/native/engine';
import { BODY_STORED_CHANNEL } from '@/shared/native/engineChannels';
import { presentActivityNotification } from '@/features/settings/light';
import {
  createPulledRidePoster,
  type PulledRideEntry,
} from '@/features/insights/lib/pulledRideNotification';

function readEntry(activityId: string): PulledRideEntry | null {
  return activities.pulledRideEntry(activityId);
}

/**
 * Post the entry the engine recorded for a Garmin ride the phone pulled itself.
 * The engine withholds the announcement when a push already announced the ride
 * or notifications are off, and records the plain entry for a ride with nothing
 * to say.
 */
export function usePulledRideNotification(): void {
  useEffect(() => {
    const engine = getEngine();
    if (!engine) return undefined;
    const post = createPulledRidePoster({
      readEntry,
      present: (activityId, title, body) =>
        presentActivityNotification(activityId, title, body, {
          route: `/activity/${activityId}`,
          activityId,
        }),
    });
    return engine.subscribe(BODY_STORED_CHANNEL, (payload) => {
      void post(payload);
    });
  }, []);
}
