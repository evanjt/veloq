import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { GarminKeyStatus } from 'veloqrs';

import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';
import { liveGarminSignInSteps, signInWithGarminKey } from '@/features/auth/lib/garminSignIn';

const STATUS_KEY = {
  [GarminKeyStatus.Connected]: 'login.garminNoAccount',
  [GarminKeyStatus.Rejected]: 'garmin.statusRejected',
  [GarminKeyStatus.Malformed]: 'garmin.statusMalformed',
  [GarminKeyStatus.Unreachable]: 'garmin.statusUnreachable',
  [GarminKeyStatus.NoActivityAccess]: 'garmin.statusNoActivityAccess',
} as const;

interface UseGarminLoginParams {
  setError: (message: string | null) => void;
}

/** The Garmin-key-only sign-in: what Garmin said about the key, shown as the login error. */
export function useGarminLogin({ setError }: UseGarminLoginParams) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const resetSyncDateRange = useSyncDateRange((state) => state.reset);
  const [isGarminLoading, setIsGarminLoading] = useState(false);

  const handleGarminLogin = useCallback(
    async (pasted: string) => {
      setIsGarminLoading(true);
      setError(null);
      try {
        const outcome = await signInWithGarminKey(pasted, liveGarminSignInSteps(queryClient));
        switch (outcome.kind) {
          case 'signedIn':
            // The root layout takes the athlete in once the library's identity is settled.
            resetSyncDateRange();
            return;
          case 'refused':
            return;
          case 'noAccount':
            setError(t(STATUS_KEY[GarminKeyStatus.Connected]));
            return;
          case 'failed':
            setError(t(STATUS_KEY[outcome.status]));
        }
      } catch {
        setError(t(STATUS_KEY[GarminKeyStatus.Unreachable]));
      } finally {
        setIsGarminLoading(false);
      }
    },
    [queryClient, resetSyncDateRange, setError, t]
  );

  return { handleGarminLogin, isGarminLoading };
}
