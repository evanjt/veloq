import React from 'react';
import { StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ActivitySyncFailure } from 'veloqrs';
import { composeAccessibilityLabel } from '@/shared/ui';
import { Button } from '@/shared/ui/Button';
import { RetryButton } from '@/shared/ui/ErrorState';
import { InlineNotice } from '@/shared/ui/InlineNotice';
import { spacing } from '@/theme';

interface ChipProps {
  activityId: string;
  retrying: boolean;
  onRetry: () => void;
}

/**
 * The small mark a feed card carries when the sync could not ready its activity,
 * and the Retry that asks the engine for that one activity again.
 */
export function ActivitySyncFailureChip({ activityId, retrying, onRetry }: ChipProps) {
  const { t } = useTranslation();
  return (
    <Button
      label={retrying ? t('activity.syncFailed.retrying') : t('activity.syncFailed.chip')}
      accessibilityLabel={composeAccessibilityLabel(
        t('activity.syncFailed.title'),
        t('common.retry')
      )}
      variant="secondary"
      size="sm"
      icon="cloud-alert"
      loading={retrying}
      onPress={onRetry}
      style={styles.chip}
      testID={`activity-card-${activityId}-sync-failed`}
    />
  );
}

interface NoticeProps {
  activityId: string;
  failure: ActivitySyncFailure;
  onRetry: () => void;
}

/** The activity screen's notice for the same fault, with the engine's wording of it. */
export function ActivitySyncFailureNotice({ activityId, failure, onRetry }: NoticeProps) {
  const { t } = useTranslation();
  return (
    <InlineNotice
      tone="warning"
      icon="cloud-alert"
      title={t('activity.syncFailed.title')}
      detail={[t('activity.syncFailed.detail'), failure.message]}
      action={<RetryButton onPress={onRetry} testID={`activity-${activityId}-sync-failed-retry`} />}
      style={styles.notice}
      testID={`activity-${activityId}-sync-failed`}
    />
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
  },
  notice: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
});
