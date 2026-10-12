import { useCallback } from 'react';
import { useNavigation, type NavigationAction } from 'expo-router/react-navigation';
import { useTranslation } from 'react-i18next';

import { confirmAction } from '@/shared/ui/dialog';
import { useBackIntercept } from './useBackIntercept';

/**
 * Holds the screen while it carries input nothing has saved. Back through the
 * header, the iOS edge swipe or Android back is held and the athlete is asked,
 * with Keep editing and a destructive Discard that carries out the held back.
 * With `dirty` false the screen leaves as it always did. The app's own
 * navigation, such as a save returning to the root past the screens beneath
 * it, is not a back and goes through.
 */
export function useDiscardGuard(dirty: boolean): void {
  const { t } = useTranslation();
  const navigation = useNavigation();

  const onBack = useCallback(
    (heldBack: NavigationAction) => {
      confirmAction({
        title: t('common.discardChangesTitle'),
        message: t('common.discardChangesMessage'),
        confirmLabel: t('common.discard'),
        cancelLabel: t('common.keepEditing'),
        destructive: true,
        onConfirm: () => navigation.dispatch(heldBack),
      });
    },
    [navigation, t]
  );

  useBackIntercept(dirty, onBack);
}
