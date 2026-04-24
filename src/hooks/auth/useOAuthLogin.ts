import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { replaceTo } from '@/lib';
import { clearAllAppCaches } from '@/lib/storage';
import { useAuthStore, useSyncDateRange, useUploadPermissionStore } from '@/providers';
import {
  startOAuthFlow,
  handleOAuthCallback,
  isOAuthConfigured,
  getAppRedirectUri,
} from '@/services/oauth';

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

        await clearAllAppCaches(queryClient);
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
