import { useTranslation } from 'react-i18next';

import { usePermissionUpgrade, useWriteAccessMissing } from '@/features/recording';
import { confirmAction } from '@/shared/ui/dialog';

/**
 * The tap on a swap: a sign-in without write access asks for it first, and the
 * swap goes ahead only once it is granted and the athlete has confirmed.
 */
export function useAskGarminSwap(swap: () => void) {
  const { t } = useTranslation();
  const writeAccessMissing = useWriteAccessMissing();
  const { upgradePermissions, isUpgrading, error: upgradeError } = usePermissionUpgrade();

  const askToSwap = async () => {
    if (writeAccessMissing) {
      const { granted } = await upgradePermissions();
      if (!granted) return;
    }
    confirmAction({
      title: t('activity.garminSwap.confirmTitle'),
      message: t('activity.garminSwap.confirmMessage'),
      confirmLabel: t('activity.garminSwap.button'),
      cancelLabel: t('common.cancel'),
      onConfirm: swap,
    });
  };

  return { askToSwap, isUpgrading, upgradePermissions, upgradeError };
}
