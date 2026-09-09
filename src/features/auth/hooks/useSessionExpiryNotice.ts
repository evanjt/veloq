/**
 * Turns the auth store's expiry flag into a notice the login screen can show.
 *
 * A session ending is not a login failure. `handleSessionExpired` deletes two
 * SecureStore keys and touches nothing else, so the activities, sections and
 * settings are all still on the device and a sign-in as the same athlete
 * brings them straight back. The screen has to say so, and it can only say
 * whose data it holds by asking for the cached identity, which is async.
 */

import { useCallback, useEffect, useState } from 'react';

import { useAuthStore, type SessionExpiredReason } from '@/shared/app/AuthStore';
import { getCachedAthleteId } from '@/features/auth/lib/accountChange';

export interface SessionExpiryNotice {
  reason: Exclude<SessionExpiredReason, null>;
  /** Whose library is still on disk, or null if the mirror has no answer. */
  cachedAthleteId: string | null;
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
      void getCachedAthleteId().then((cachedAthleteId) => {
        if (cancelled) return;
        setNotice({ reason, cachedAthleteId });
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
