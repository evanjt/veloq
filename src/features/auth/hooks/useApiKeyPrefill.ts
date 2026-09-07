/**
 * The key to put back in the login form after a rejected session.
 *
 * An athlete signed out by a 401 lands here with one field to fill and no way
 * to tell which key was in use, on a device that still holds their whole
 * library. The key survives the sign-out for exactly this, so a key that
 * still works is one tap and a regenerated one is a paste over the top.
 *
 * A first sign-in is not a re-entry and gets nothing: the notice is what says
 * which of the two this is.
 */

import { useEffect, useState } from 'react';

import { readApiKeyForAthlete } from '@/shared/app/AuthStore';

import type { SessionExpiryNotice } from './useSessionExpiryNotice';

export function useApiKeyPrefill(notice: SessionExpiryNotice | null): string | null {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const cachedAthleteId = notice?.cachedAthleteId ?? null;

  useEffect(() => {
    let cancelled = false;

    if (cachedAthleteId) {
      void readApiKeyForAthlete(cachedAthleteId).then((stored) => {
        if (!cancelled) setApiKey(stored);
      });
    }

    return () => {
      cancelled = true;
    };
  }, [cachedAthleteId]);

  return apiKey;
}
