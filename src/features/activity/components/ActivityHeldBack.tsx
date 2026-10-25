import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ActivityHeldBack } from 'veloqrs';
import { EmptyState } from '@/shared/ui';
import { navigateTo } from '@/shared/app/navigation';
import { spacing } from '@/theme';

interface Props {
  activityId: string;
  heldBack: ActivityHeldBack;
}

/**
 * The opened ride's empty state for an activity intervals.icu holds but does not
 * serve to apps. A Garmin import also offers the Garmin connector, which fills it
 * from the original.
 */
export function ActivityHeldBackNotice({ activityId, heldBack }: Props) {
  const { t } = useTranslation();
  const fromGarmin = heldBack.source?.toUpperCase().startsWith('GARMIN') ?? false;
  return (
    <View style={styles.notice}>
      <EmptyState
        variant="compact"
        icon="cloud-off-outline"
        title={t('activity.heldBack.title')}
        description={
          fromGarmin ? t('activity.heldBack.detailGarmin') : t('activity.heldBack.detail')
        }
        actionLabel={fromGarmin ? t('activity.heldBack.connectGarmin') : undefined}
        onAction={fromGarmin ? () => navigateTo('/garmin-connector') : undefined}
        actionTestID={`activity-${activityId}-held-back-connect-garmin`}
        testID={`activity-${activityId}-held-back`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
});
