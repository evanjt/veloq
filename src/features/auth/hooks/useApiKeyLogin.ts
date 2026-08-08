import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { routeEngine } from 'veloqrs';

import { replaceTo } from '@/shared/app/navigation';
import { clearAccountData, clearAuthOnly } from '@/shared/storage';
import { confirmAccountChange, getCachedAthleteId } from '@/features/auth/lib/accountChange';
import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';
import { useAuthStore } from '@/shared/app/AuthStore';

interface UseApiKeyLoginParams {
  setError: (message: string | null) => void;
}

export function useApiKeyLogin({ setError }: UseApiKeyLoginParams) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const resetSyncDateRange = useSyncDateRange((state) => state.reset);
  const setCredentials = useAuthStore((state) => state.setCredentials);

  const [isApiKeyLoading, setIsApiKeyLoading] = useState(false);

  const handleApiKeyLogin = useCallback(
    async (apiKey: string) => {
      if (!apiKey.trim()) {
        setError(t('login.apiKeyRequired'));
        return;
      }

      setIsApiKeyLoading(true);
      setError(null);

      try {
        // The engine checks the key against /athlete/me without storing it, so
        // a rejected key never becomes the credential the app syncs with.
        const check = await routeEngine.validateSyncCredentials('api_key', apiKey.trim());
        if (check.kind !== 'ok' || !check.id) {
          setError(check.status === 401 ? t('login.invalidApiKey') : t('login.connectionFailed'));
          return;
        }

        // Account-identity check. Engine holds at most one account at a time,
        // so a different incoming athlete means we must wipe cached data
        // before letting the new identity in. Same-account login keeps data
        // for instant resume; only the auth/profile blobs are dropped so the
        // previous user's avatar can't bleed through.
        const incomingId = check.id;
        const cachedId = getCachedAthleteId();
        if (cachedId && cachedId !== incomingId) {
          const proceed = await confirmAccountChange({
            cachedAthleteId: cachedId,
            incomingKind: 'login',
          });
          if (!proceed) {
            setIsApiKeyLoading(false);
            return;
          }
          await clearAccountData(queryClient);
        } else {
          await clearAuthOnly(queryClient);
        }
        resetSyncDateRange();
        await setCredentials(apiKey.trim(), incomingId);
        replaceTo('/');
      } catch {
        setError(t('login.connectionFailed'));
      } finally {
        setIsApiKeyLoading(false);
      }
    },
    [t, queryClient, resetSyncDateRange, setCredentials, setError]
  );

  return { handleApiKeyLogin, isApiKeyLoading };
}
