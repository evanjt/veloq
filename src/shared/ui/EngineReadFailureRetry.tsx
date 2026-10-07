/**
 * The engine failure line with a Retry, for a card whose read threw.
 *
 * Shown in place of the empty state, so a failed read does not read as a period
 * the athlete did not ride.
 */

import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { engineErrorKey } from '@/shared/native/engineError';
import { EmptyState } from './EmptyState';

interface EngineReadFailureRetryProps {
  /** What the read threw. */
  error: unknown;
  onRetry: () => void;
  testID: string;
}

export function EngineReadFailureRetry({ error, onRetry, testID }: EngineReadFailureRetryProps) {
  const { t } = useTranslation();
  return (
    <View testID={testID}>
      <EmptyState
        compact
        icon="alert-circle-outline"
        title={t(engineErrorKey(error, 'engine.failure.database'))}
        actionLabel={t('common.retry')}
        onAction={onRetry}
      />
    </View>
  );
}
