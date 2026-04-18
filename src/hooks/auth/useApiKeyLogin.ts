import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { replaceTo } from '@/lib';
import { clearAllAppCaches } from '@/lib/storage';
import { useAuthStore, useSyncDateRange } from '@/providers';

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

        await clearAllAppCaches(queryClient);
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
