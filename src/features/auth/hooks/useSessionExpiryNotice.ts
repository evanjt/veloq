/**
 * Turns the auth store's expiry flag into a notice the login screen can show.
 *
 * A session ending is not a login failure. `handleSessionExpired` deletes two
 * SecureStore keys and touches nothing else, so the activities, sections and
 * settings are all still on the device and a sign-in as the same athlete
 * brings them straight back. The screen has to say so, and it can only say
 * whose data it holds by asking for the cached identity, which is async. A
 * ride the sign-out held for that athlete is named too, since it reopens only
 * when they sign in again.
 */

import { useCallback, useEffect, useState } from 'react';

import { useAuthStore, type SessionExpiredReason } from '@/shared/app/AuthStore';
import { getCachedAthleteId } from '@/features/auth/lib/accountChange';
import { heldRideStart } from '@/features/recording';

export interface SessionExpiryNotice {
  reason: Exclude<SessionExpiredReason, null>;
  /** Whose library is still on disk, or null if the mirror has no answer. */
  cachedAthleteId: string | null;
  /** When the ride held for that athlete started, or null when none is held. */
  heldRideStart: number | null;
}

/** The notice to show, and the dismissal a fresh login failure owes it. */
export function useSessionExpiryNotice(): [SessionExpiryNotice | null, () => void] {
  const sessionExpired = useAuthStore((state) => state.sessionExpired);
  const clearSessionExpired = useAuthStore((state) => state.clearSessionExpired);
  const [notice, setNotice] = useState<SessionExpiryNotice | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (sessionExpired) {
      const reason = sessionExpired;
      // The flag is consumed only once the notice is ready. Clearing it first
      // would retire this effect, and its cleanup would then cancel the very
      // lookup the notice is waiting on.
      void getCachedAthleteId().then(async (cachedAthleteId) => {
        const heldRide = cachedAthleteId ? await heldRideStart(cachedAthleteId) : null;
        if (cancelled) return;
        setNotice({ reason, cachedAthleteId, heldRideStart: heldRide });
        clearSessionExpired();
      });
    }

    return () => {
      cancelled = true;
    };
  }, [sessionExpired, clearSessionExpired]);

  const dismiss = useCallback(() => setNotice(null), []);

  return [notice, dismiss];
}
