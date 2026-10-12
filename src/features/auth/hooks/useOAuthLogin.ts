import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';

import { replaceTo } from '@/shared/app/navigation';
import { clearAccountData, clearAuthOnly } from '@/shared/storage';
import { resolveLoginLibrary } from '@/features/auth/lib/loginLibrary';
import { recordGrantedScope } from '@/features/auth/lib/grantedScope';
import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useNetwork } from '@/shared/app/NetworkContext';
import {
  startOAuthFlow,
  handleOAuthCallback,
  isOAuthConfigured,
  getAppRedirectUri,
  oauthFailureKey,
  onInterruptedCallback,
  takeInterruptedCallback,
} from '@/features/auth/lib/oauth';
import { clearPendingApiKey } from '@/features/auth/lib/pendingSignIn';

interface UseOAuthLoginParams {
  setError: (message: string | null) => void;
  /**
   * Drops a key queued offline when the athlete refuses the account change.
   * The login screen passes its own, which takes the waiting banner with it.
   */
  discardQueuedKey?: () => Promise<void>;
}

export function useOAuthLogin({
  setError,
  discardQueuedKey = clearPendingApiKey,
}: UseOAuthLoginParams) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const resetSyncDateRange = useSyncDateRange((state) => state.reset);
  const setOAuthCredentials = useAuthStore((state) => state.setOAuthCredentials);
  const { isOnline } = useNetwork();

  const [isLoading, setIsLoading] = useState(false);

  /**
   * Redeem the redirect and sign its athlete in. Resolves with nothing either
   * way: a refused account change is the athlete's own choice, not an error.
   */
  const completeSignIn = useCallback(
    async (callbackUrl: string) => {
      const tokenResponse = await handleOAuthCallback(callbackUrl);

      // Account-identity check (see useApiKeyLogin.ts). Same-account OAuth
      // refresh keeps cached activities; switching accounts requires
      // explicit confirmation before we wipe the previous identity.
      const incomingId = String(tokenResponse.athlete_id);
      const outcome = await resolveLoginLibrary(incomingId);
      // A refused sign-in drops the queued key as the API-key path does:
      // otherwise the next reconnect signs its owner in unasked.
      if (outcome === 'refused') {
        await discardQueuedKey();
        return;
      }
      if (outcome === 'keep') {
        await clearAuthOnly(queryClient);
      } else {
        await clearAccountData(queryClient);
      }
      resetSyncDateRange();

      await setOAuthCredentials(
        tokenResponse.access_token,
        tokenResponse.athlete_id,
        tokenResponse.athlete_name
      );

      recordGrantedScope(tokenResponse.scope);

      replaceTo('/');
    },
    [queryClient, resetSyncDateRange, setOAuthCredentials, discardQueuedKey]
  );

  const handleOAuthLogin = useCallback(async () => {
    if (!isOAuthConfigured()) {
      setError(t('login.oauthNotConfigured'));
      return;
    }

    // The flow registers with the proxy before the browser opens, so offline
    // it can only fail, and what it fails with is the platform's English.
    if (!isOnline) {
      setError(t('login.oauthNeedsNetwork'));
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await startOAuthFlow();

      if (result.outcome === 'success') {
        const expectedPrefix = getAppRedirectUri();
        if (!result.url.startsWith(expectedPrefix)) {
          setError(t('login.oauthInvalidCallback', { defaultValue: 'Invalid OAuth callback URL' }));
          setIsLoading(false);
          return;
        }

        await completeSignIn(result.url);
      } else if (result.outcome === 'failed') {
        setError(t('login.oauthFailed'));
      }
    } catch (err: unknown) {
      setError(t(oauthFailureKey(err)));
    } finally {
      setIsLoading(false);
    }
  }, [t, isOnline, completeSignIn, setError]);

  // A redirect that reached a process which did not open the browser: Android
  // killed the one that did. The keychain still holds the flow, so it is
  // completed here, with the button showing progress while the code is
  // redeemed, or the slot says the sign-in was interrupted.
  useEffect(() => {
    const resume = () => {
      const callbackUrl = takeInterruptedCallback();
      if (!callbackUrl) return;
      setIsLoading(true);
      setError(null);
      completeSignIn(callbackUrl)
        .catch((err: unknown) => setError(t(oauthFailureKey(err))))
        .finally(() => setIsLoading(false));
    };
    resume();
    return onInterruptedCallback(resume);
  }, [completeSignIn, setError, t]);

  return { handleOAuthLogin, isLoading };
}
