import React from 'react';
import { StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ActivityHeldBack } from 'veloqrs';
import { InlineNotice } from '@/shared/ui/InlineNotice';
import { spacing } from '@/theme';

interface Props {
  activityId: string;
  heldBack: ActivityHeldBack;
}

/**
 * The activity screen's notice for an activity intervals.icu holds but does not
 * serve to apps. A Garmin import also says how to fill it.
 */
export function ActivityHeldBackNotice({ activityId, heldBack }: Props) {
  const { t } = useTranslation();
  const fromGarmin = heldBack.source?.toUpperCase().startsWith('GARMIN') ?? false;
  return (
    <InlineNotice
      tone="info"
      icon="cloud-off-outline"
      title={t('activity.heldBack.title')}
      detail={[
        t('activity.heldBack.detail'),
        fromGarmin ? t('activity.heldBack.detailGarmin') : '',
      ]}
      style={styles.notice}
      testID={`activity-${activityId}-held-back`}
    />
  );
}

const styles = StyleSheet.create({
  notice: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
});
