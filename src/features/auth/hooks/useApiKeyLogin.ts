import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { CallKind, validateCredentials } from 'veloqrs';

import { replaceTo } from '@/shared/app/navigation';
import { clearAccountData, clearAuthOnly } from '@/shared/storage';
import {
  accountChangeAction,
  confirmAccountChange,
  getCachedAthleteId,
} from '@/features/auth/lib/accountChange';
import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useNetwork } from '@/shared/app/NetworkContext';
import { useReconnect } from '@/shared/app/useRetryTriggers';
import {
  clearPendingApiKey,
  readPendingApiKey,
  savePendingApiKey,
  signInPlan,
} from '@/features/auth/lib/pendingSignIn';

/** What became of a sign-in attempt. */
type SignInOutcome = 'signedIn' | 'rejected' | 'unreachable' | 'refused';

interface UseApiKeyLoginParams {
  setError: (message: string | null) => void;
}

export function useApiKeyLogin({ setError }: UseApiKeyLoginParams) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const resetSyncDateRange = useSyncDateRange((state) => state.reset);
  const setCredentials = useAuthStore((state) => state.setCredentials);

  const [isApiKeyLoading, setIsApiKeyLoading] = useState(false);
  const [queuedMessage, setQueuedMessage] = useState<string | null>(null);
  const { isOnline } = useNetwork();

  /**
   * What became of an attempt: `unreachable` is the one outcome that keeps a
   * held key, since the server never said anything about it.
   */
  const signIn = useCallback(
    async (apiKey: string): Promise<SignInOutcome> => {
      setIsApiKeyLoading(true);
      setError(null);

      try {
        // Checked against /athlete/me without being stored, so a rejected key
        // never becomes the credential the app syncs with.
        //
        // Not through the engine: the layout opens one only once the athlete is
        // authenticated, so on a fresh install there is no engine here and the
        // engine-object form answered "unavailable", which this screen rendered
        // as a connection failure for a perfectly good key.
        const check = await validateCredentials('api_key', apiKey.trim());
        if (check.kind !== CallKind.Ok || !check.id) {
          const rejected = check.status === 401;
          setError(rejected ? t('login.invalidApiKey') : t('login.connectionFailed'));
          return rejected ? 'rejected' : 'unreachable';
        }

        // Account-identity check. Engine holds at most one account at a time,
        // so a different incoming athlete means we must wipe cached data
        // before letting the new identity in. Same-account login keeps data
        // for instant resume; only the auth/profile blobs are dropped so the
        // previous user's avatar can't bleed through.
        const incomingId = check.id;
        const cachedId = await getCachedAthleteId();
        const action = accountChangeAction(cachedId, incomingId);
        if (cachedId && action === 'confirm-then-wipe') {
          const proceed = await confirmAccountChange({
            cachedAthleteId: cachedId,
            incomingKind: 'login',
          });
          if (!proceed) {
            setIsApiKeyLoading(false);
            return 'refused';
          }
        }
        if (action === 'keep') {
          await clearAuthOnly(queryClient);
        } else {
          await clearAccountData(queryClient);
        }
        resetSyncDateRange();
        await setCredentials(apiKey.trim(), incomingId);
        replaceTo('/');
        return 'signedIn';
      } catch {
        setError(t('login.connectionFailed'));
        return 'unreachable';
      } finally {
        setIsApiKeyLoading(false);
      }
    },
    [t, queryClient, resetSyncDateRange, setCredentials, setError]
  );

  const handleApiKeyLogin = useCallback(
    async (apiKey: string) => {
      switch (signInPlan(isOnline, apiKey)) {
        case 'empty':
          setError(t('login.apiKeyRequired'));
          return;
        case 'queue':
          // Held, not signed in. The check that would refuse it, and the
          // athlete-identity check that guards the cached library, both run on
          // the reconnect edge below.
          await savePendingApiKey(apiKey);
          setError(null);
          setQueuedMessage(t('login.queuedOffline'));
          return;
        case 'validate':
          setQueuedMessage(null);
          await signIn(apiKey);
      }
    },
    [isOnline, signIn, setError, t]
  );

  // The radio came back, so the key that was typed without one gets the check
  // it never had. A key the server refuses is dropped rather than retried for
  // ever; one the server could not answer for at all stays held.
  useReconnect(() => {
    void (async () => {
      const pending = await readPendingApiKey();
      if (!pending) return;
      setQueuedMessage(null);
      const outcome = await signIn(pending);
      if (outcome !== 'unreachable') await clearPendingApiKey();
    })();
  });

  return { handleApiKeyLogin, isApiKeyLoading, queuedMessage };
}
