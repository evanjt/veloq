import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';

import { replaceTo } from '@/shared/app/navigation';
import { clearAccountData, clearAuthOnly } from '@/shared/storage';
import { confirmAccountChange, getCachedAthleteId } from '@/features/auth/lib/accountChange';
import { useUploadPermissionStore } from '@/features/recording/stores/UploadPermissionStore';
import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';
import { useAuthStore } from '@/shared/app/AuthStore';
import {
  startOAuthFlow,
  handleOAuthCallback,
  isOAuthConfigured,
  getAppRedirectUri,
} from '@/features/auth/lib/oauth';

interface UseOAuthLoginParams {
  setError: (message: string | null) => void;
}

export function useOAuthLogin({ setError }: UseOAuthLoginParams) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const resetSyncDateRange = useSyncDateRange((state) => state.reset);
  const setOAuthCredentials = useAuthStore((state) => state.setOAuthCredentials);

  const [isLoading, setIsLoading] = useState(false);

  const handleOAuthLogin = useCallback(async () => {
    if (!isOAuthConfigured()) {
      setError(t('login.oauthNotConfigured'));
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await startOAuthFlow();

      if (result.type === 'success' && result.url) {
        const expectedPrefix = getAppRedirectUri();
        if (!result.url.startsWith(expectedPrefix)) {
          setError(t('login.oauthInvalidCallback', { defaultValue: 'Invalid OAuth callback URL' }));
          setIsLoading(false);
          return;
        }

        const tokenResponse = handleOAuthCallback(result.url);

        // Account-identity check (see useApiKeyLogin.ts). Same-account OAuth
        // refresh keeps cached activities; switching accounts requires
        // explicit confirmation before we wipe the previous identity.
        const incomingId = String(tokenResponse.athlete_id);
        const cachedId = getCachedAthleteId();
        if (cachedId && cachedId !== incomingId) {
          const proceed = await confirmAccountChange({
            cachedAthleteId: cachedId,
            incomingKind: 'login',
          });
          if (!proceed) {
            setIsLoading(false);
            return;
          }
          await clearAccountData(queryClient);
        } else {
          await clearAuthOnly(queryClient);
        }
        resetSyncDateRange();

        await setOAuthCredentials(
          tokenResponse.access_token,
          tokenResponse.athlete_id,
          tokenResponse.athlete_name
        );

        if (tokenResponse.scope) {
          useUploadPermissionStore.getState().setFromOAuthScope(tokenResponse.scope);
        }

        replaceTo('/');
      } else if (result.type === 'cancel') {
        setIsLoading(false);
        return;
      } else {
        setError(t('login.oauthFailed'));
      }
    } catch (err: unknown) {
      let errorMessage = t('login.connectionFailed');
      if (err instanceof Error) {
        if (
          err.message.includes('state validation failed') ||
          err.message.includes('missing state parameter')
        ) {
          errorMessage = t('login.oauthStateValidationFailed');
        } else {
          errorMessage = err.message;
        }
      }
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [t, queryClient, resetSyncDateRange, setOAuthCredentials, setError]);

  return { handleOAuthLogin, isLoading };
}
