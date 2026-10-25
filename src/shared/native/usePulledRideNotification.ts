import { useEffect } from 'react';

import { getEngine } from '@/shared/native/engine';
import { getSetting } from '@/shared/storage';
import { safeJsonParse } from '@/shared/validation/validation';
import { pushNotificationTemplates } from '@/i18n/notificationTemplates';
import { presentActivityNotification } from '@/features/settings/light';
import {
  createPulledRidePoster,
  type PulledRideEntry,
} from '@/features/insights/lib/pulledRideNotification';
import type { NotificationPreferences } from '@/features/settings/light';

const PREFS_KEY = 'veloq-notification-preferences';

async function readEntry(activityId: string): Promise<PulledRideEntry | null> {
  const engine = getEngine();
  const raw = await getSetting(PREFS_KEY);
  if (!engine || !raw) return null;
  const prefs = safeJsonParse<NotificationPreferences | null>(raw, null);
  if (prefs?.enabled !== true) return null;
  pushNotificationTemplates();
  const name = engine.getActivityRecord(activityId)?.name ?? '';
  return engine.activityNotification(
    activityId,
    name,
    prefs.categories.sectionPr,
    prefs.categories.fitnessMilestone
  );
}

/**
 * Post the entry the engine owes for a Garmin ride the phone pulled itself.
 * The engine withholds the announcement when a push already announced the ride
 * or notifications are off.
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
    return engine.subscribe('bodyStored', (payload) => {
      void post(payload);
    });
  }, []);
}
