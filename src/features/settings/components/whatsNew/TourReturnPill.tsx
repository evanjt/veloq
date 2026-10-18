import React from 'react';
import { useTranslation } from 'react-i18next';
import Constants from 'expo-constants';
import { useWhatsNewStore } from '@/features/settings/stores/WhatsNewStore';
import { setUpInSettings } from '@/features/settings/lib/tourSetUp';
import { FloatingPill } from '@/shared/ui/FloatingPill';

/**
 * The way back into the tour while the athlete explores the screen it showed. Pressing it
 * returns to the tour; closing the tour is the pill's second action, a long press or the
 * accessible action, so the pill stays one button.
 */
export function TourReturnPill() {
  const { t } = useTranslation();
  const tourState = useWhatsNewStore((s) => s.tourState);
  const resumeTour = useWhatsNewStore((s) => s.resumeTour);
  const dismissTour = useWhatsNewStore((s) => s.dismissTour);

  if (!tourState || !tourState.exploring) return null;

  const currentVersion = Constants.expoConfig?.version ?? '';

  return (
    <FloatingPill
      testID="tour-return-pill"
      icon="compass-outline"
      title={t('whatsNew.backToTour')}
      detail={tourState.tip ? t(tourState.tip as never) : null}
      onPress={resumeTour}
      accessibilityLabel={t('whatsNew.backToTour')}
      secondaryAction={{
        label: t('whatsNew.closeTour'),
        onAction: () => dismissTour(currentVersion, setUpInSettings()),
      }}
    />
  );
}
