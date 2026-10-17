import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui';
import { tapTo } from '@/shared/app/navigation';
import type { Period } from '@/shared/app/period';
import { bestEffortsHref } from '@/features/stats';

/** The Fitness tab's trailing header item, which opens Best Efforts on the range Fitness shows. */
export function BestEffortsHeaderButton({ period }: { period: Period }) {
  const { t } = useTranslation();
  return (
    <Button
      testID="fitness-best-efforts-button"
      label={t('bestEffortsScreen.title')}
      variant="ghost"
      size="sm"
      onPress={() => tapTo(bestEffortsHref(period))}
      icon="trophy-outline"
    />
  );
}
