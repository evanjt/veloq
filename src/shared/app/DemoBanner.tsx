import React from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { runWhenIdle } from '@/shared/async/runWhenIdle';
import { useAuthStore } from '@/shared/app/AuthStore';
import { NoticeBanner } from '@/shared/ui/NoticeBanner';
import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';
import { clearDemoData } from '@/shared/storage';
import { engineErrorKey } from '@/shared/native/engineError';
import { inform } from '@/shared/ui/dialog';

export function DemoBanner() {
  const { t } = useTranslation();
  const isDemoMode = useAuthStore((state) => state.isDemoMode);
  const hideDemoBanner = useAuthStore((state) => state.hideDemoBanner);
  const exitDemoMode = useAuthStore((state) => state.exitDemoMode);
  const queryClient = useQueryClient();
  const resetSyncDateRange = useSyncDateRange((state) => state.reset);

  // Don't render if not in demo mode or if banner is hidden
  if (!isDemoMode || hideDemoBanner) return null;

  const handlePress = async () => {
    await exitDemoMode();
    resetSyncDateRange();
    // Defer data clearing until the navigation interaction completes. Calling
    // queryClient.clear() while tab screens are still mounted triggers a mass
    // re-render cascade that crashes Android with IllegalStateException
    // (null child in ReactViewGroup during dispatchGetDisplayList).
    //
    // The banner is gone by the time this runs, so a wipe that fails has to
    // say so here or the fixtures stay on disk with nothing on screen.
    runWhenIdle(async () => {
      try {
        await clearDemoData(queryClient);
      } catch (error) {
        inform({
          title: t('alerts.clearFailedTitle'),
          message: t(engineErrorKey(error, 'alerts.failedToClear')),
        });
      }
    });
  };

  return (
    <NoticeBanner
      slot="demo"
      tone="info"
      icon="information"
      title={t('demo.banner', { defaultValue: 'Demo mode' })}
      actions={[
        {
          label: t('demo.signIn', { defaultValue: 'Sign in' }),
          onPress: handlePress,
          testID: 'demo-mode-sign-in',
        },
      ]}
      testID="demo-mode-banner"
    />
  );
}
