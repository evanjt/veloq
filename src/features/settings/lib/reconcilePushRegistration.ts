import { useAuthStore } from '@/shared/app/AuthStore';
import { sourceFor } from '@/shared/app/source';
import { readNotificationPermission } from '@/shared/app/permissions/notifications';
import {
  getNotificationPreferences,
  resolvePendingUnregisterAthleteId,
  retryPendingUnregister,
} from '../stores/NotificationPreferencesStore';
import { ensurePushTokenRegistered, refreshPushTokenRegistration } from './pushTokenRegistration';

/**
 * On app open, register the push token when notifications are on for a real
 * session, which also refreshes its server-side life. Otherwise retry any
 * unregister a previous session left pending.
 */
export function reconcilePushRegistrationOnLaunch(): void {
  const prefs = getNotificationPreferences();
  const { athleteId, authMethod, isDemoMode } = useAuthStore.getState();
  if (prefs.enabled && athleteId && sourceFor({ authMethod, isDemoMode })?.id !== 'demo') {
    void ensurePushTokenRegistered(athleteId);
    return;
  }
  // The id comes from the request, not the session: a sign-out between the
  // two deletes the credential and the retry never fires again.
  const pendingFor = resolvePendingUnregisterAthleteId();
  if (pendingFor) void retryPendingUnregister(pendingFor);
}

/**
 * On a return to the foreground, refresh the push token while notifications
 * are on in Veloq and allowed by the system. A system setting turned off leaves
 * the athlete's own choice standing, so turning it back on there brings
 * notifications back without a visit to the switch; the settings screen names
 * the system setting meanwhile.
 */
export async function reconcilePushRegistrationOnForeground(): Promise<void> {
  if (!getNotificationPreferences().enabled) return;
  const outcome = await readNotificationPermission().catch(() => null);
  if (outcome !== 'granted') return;
  const { athleteId } = useAuthStore.getState();
  if (athleteId) await refreshPushTokenRegistration(athleteId).catch(() => {});
}
