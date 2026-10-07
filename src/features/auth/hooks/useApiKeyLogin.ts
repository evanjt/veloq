import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { CallKind, validateCredentials } from 'veloqrs';

import { replaceTo } from '@/shared/app/navigation';
import { clearAccountData, clearAuthOnly } from '@/shared/storage';
import { resolveLoginLibrary } from '@/features/auth/lib/loginLibrary';
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
  const [pendingRetryRun, setPendingRetryRun] = useState(0);
  const { isOnline } = useNetwork();
  const pendingReadRef = useRef(false);
  const pendingValidationRef = useRef(false);
  const pendingRetryRef = useRef(false);
  const pendingGenerationRef = useRef(0);

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
          if (rejected) await clearPendingApiKey();
          return rejected ? 'rejected' : 'unreachable';
        }

        // Account-identity check. Engine holds at most one account at a time,
        // so a different incoming athlete means we must wipe cached data
        // before letting the new identity in. Same-account login keeps data
        // for instant resume; the query cache is cleared and the profile stays
        // hidden while signed out.
        const incomingId = check.id;
        const outcome = await resolveLoginLibrary(incomingId);
        if (outcome === 'refused') {
          await clearPendingApiKey();
          setIsApiKeyLoading(false);
          return 'refused';
        }
        if (outcome === 'keep') {
          await clearAuthOnly(queryClient);
        } else {
          await clearAccountData(queryClient);
        }
        resetSyncDateRange();
        await setCredentials(apiKey.trim(), incomingId);
        await clearPendingApiKey();
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
          // athlete-identity check that guards the cached library run on return.
          pendingGenerationRef.current += 1;
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

  const validatePending = useCallback(async () => {
    if (pendingValidationRef.current) {
      pendingRetryRef.current = true;
      return;
    }
    pendingValidationRef.current = true;
    const generation = pendingGenerationRef.current;
    try {
      const pending = await readPendingApiKey();
      if (!pending || generation !== pendingGenerationRef.current) return;
      if (!isOnline) {
        setQueuedMessage(t('login.queuedOffline'));
        return;
      }
      setQueuedMessage(null);
      await signIn(pending);
    } finally {
      pendingValidationRef.current = false;
      if (pendingRetryRef.current) {
        pendingRetryRef.current = false;
        setPendingRetryRun((previous) => previous + 1);
      }
    }
  }, [isOnline, signIn, t]);

  useEffect(() => {
    if (pendingReadRef.current) return;
    pendingReadRef.current = true;
    void validatePending();
  }, [validatePending]);

  useEffect(() => {
    if (pendingRetryRun) void validatePending();
  }, [pendingRetryRun, validatePending]);

  // The radio came back, so the key that was typed without one gets the check
  // it never had. A key the server refuses is dropped rather than retried for
  // ever; one the server could not answer for at all stays held.
  useReconnect(() => {
    void validatePending();
  });

  const discardQueuedKey = useCallback(async () => {
    pendingGenerationRef.current += 1;
    await clearPendingApiKey();
    setQueuedMessage(null);
  }, []);

  return { handleApiKeyLogin, isApiKeyLoading, queuedMessage, discardQueuedKey };
}
