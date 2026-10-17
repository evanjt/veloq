/**
 * What the feed shows on a first launch, while the library is still empty.
 *
 * A fresh install used to land on "No activities" over a summary card of
 * zeros, with a download cloud on every card that arrived, for as long as the
 * first sync took. The query resolves empty long before anything is stored, so
 * nothing on the screen was a loading state. This says what is happening and
 * carries the engine's own counts, and it is gone the moment the first cards
 * land.
 *
 * The step line is the only progress on the Feed while this shows, so it
 * reaches a screen reader the way the sync strip's line does: a polite live
 * region on Android, and on iOS, which has none, an announcement of the step's
 * label, so a new step is spoken and a moving count inside one is not. The
 * spinner is the busy progress bar a screen reader lands on, valued from the
 * step's own counts when it has them.
 */

import React from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { formatSyncProgress, formatSyncProgressParts } from '@/shared/format/syncProgress';
import { useSyncStatus } from '@/shared/native/useSyncStatus';
import { progressValue } from '@/shared/ui/ProgressRow';
import { SectionTitle } from '@/shared/ui/SectionTitle';
import { useAnnounceOnAppear } from '@/shared/ui/useAnnounceOnAppear';
import { colors, darkColors, spacing, typography } from '@/theme';

export function FeedFirstSyncStandby() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const status = useSyncStatus();
  const hasStep = status?.step !== undefined;
  const itemsTotal = hasStep ? (status?.stepItemsTotal ?? 0) : 0;
  useAnnounceOnAppear(hasStep ? formatSyncProgressParts(status, t).label : null);

  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;

  return (
    <View style={styles.container} testID="feed-first-sync-standby">
      <ActivityIndicator
        size="large"
        color={colors.actionPrimary}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={t('feed.firstSyncTitle')}
        accessibilityState={{ busy: true }}
        accessibilityValue={
          itemsTotal > 0 ? progressValue(status?.stepItemsDone ?? 0, itemsTotal) : undefined
        }
      />
      <SectionTitle align="center" testID="feed-first-sync-title">
        {t('feed.firstSyncTitle')}
      </SectionTitle>
      <Text style={[styles.body, { color: textSecondary }]} testID="feed-first-sync-body">
        {t('feed.firstSyncBody')}
      </Text>
      {hasStep ? (
        <Text
          style={[styles.step, { color: textSecondary }]}
          testID="feed-first-sync-step"
          accessibilityLiveRegion="polite"
        >
          {formatSyncProgress(status, t)}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
  },
  body: {
    ...typography.bodyCompact,
    textAlign: 'center',
  },
  step: {
    ...typography.bodyCompact,
    textAlign: 'center',
  },
});
