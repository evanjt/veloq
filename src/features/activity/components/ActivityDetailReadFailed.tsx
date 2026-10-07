import React from 'react';
import { useTranslation } from 'react-i18next';

import { engineErrorKey } from '@/shared/native/engineError';
import { ErrorStatePreset } from '@/shared/ui';

interface ActivityDetailReadFailedProps {
  error: unknown;
  onRetry: () => void;
}

/**
 * Stands in for the Routes and Sections tabs when the detail bundle read threw,
 * so a failed read is not drawn as an activity that matched nothing.
 */
export function ActivityDetailReadFailed({ error, onRetry }: ActivityDetailReadFailedProps) {
  const { t } = useTranslation();
  return (
    <ErrorStatePreset
      message={t(engineErrorKey(error, 'activityDetail.failedToLoad'))}
      onRetry={onRetry}
    />
  );
}
