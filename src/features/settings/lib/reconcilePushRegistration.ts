import { useAuthStore } from '@/shared/app/AuthStore';
import {
  getNotificationPreferences,
  resolvePendingUnregisterAthleteId,
  retryPendingUnregister,
} from '../stores/NotificationPreferencesStore';
import { ensurePushTokenRegistered } from './pushTokenRegistration';

/**
 * On app open, register the push token when notifications are on for a real
 * session, which also refreshes its server-side life. Otherwise retry any
 * unregister a previous session left pending.
 */
export function reconcilePushRegistrationOnLaunch(): void {
  const prefs = getNotificationPreferences();
  const { athleteId, isDemoMode } = useAuthStore.getState();
  if (prefs.enabled && athleteId && !isDemoMode) {
    void ensurePushTokenRegistered(athleteId);
    return;
  }
  // The id comes from the request, not the session: a sign-out between the
  // two deletes the credential and the retry never fires again.
  const pendingFor = resolvePendingUnregisterAthleteId();
  if (pendingFor) void retryPendingUnregister(pendingFor);
}
