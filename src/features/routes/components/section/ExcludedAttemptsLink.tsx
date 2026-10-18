import React from 'react';
import { useTranslation } from 'react-i18next';

import { TextLink } from '@/shared/ui';

/**
 * The excluded attempts are hidden by default, behind a link that says how
 * many there are, and the same link hides them again.
 */
export function ExcludedAttemptsLink({
  count,
  shown,
  onToggle,
}: {
  count: number;
  shown: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  return (
    <TextLink
      testID="performance-excluded-link"
      label={
        shown ? t('sections.hideExcludedAttempts') : t('sections.showExcludedAttempts', { count })
      }
      onPress={onToggle}
      size="caption"
      accessibilityRole="button"
    />
  );
}
