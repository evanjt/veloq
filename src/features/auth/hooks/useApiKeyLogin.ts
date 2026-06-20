import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import axios from 'axios';

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
        const response = await axios.get('https://intervals.icu/api/v1/athlete/me', {
          headers: {
            Authorization: `Basic ${btoa('API_KEY:' + apiKey.trim())}`,
          },
          timeout: 10000,
        });

        const athlete = response.data;
        if (!athlete?.id) {
          throw new Error('Invalid response');
        }

        // Account-identity check. Engine holds at most one account at a time,
        // so a different incoming athlete means we must wipe cached data
        // before letting the new identity in. Same-account login keeps data
        // for instant resume; only the auth/profile blobs are dropped so the
        // previous user's avatar can't bleed through.
        const incomingId = String(athlete.id);
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
        await setCredentials(apiKey.trim(), athlete.id);
        replaceTo('/');
      } catch (err: unknown) {
        if (axios.isAxiosError(err) && err.response?.status === 401) {
          setError(t('login.invalidApiKey'));
        } else {
          setError(t('login.connectionFailed'));
        }
      } finally {
        setIsApiKeyLoading(false);
      }
    },
    [t, queryClient, resetSyncDateRange, setCredentials, setError]
  );

  return { handleApiKeyLogin, isApiKeyLoading };
}
