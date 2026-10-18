/**
 * What the feed shows on a first launch, while the library is still empty.
 *
 * A fresh install used to land on "No activities" over a summary card of
 * zeros, with a download cloud on every card that arrived, for as long as the
 * first sync took. The query resolves empty long before anything is stored, so
 * nothing on the screen was a loading state. This says what is happening and
 * carries the engine's own counts, and it is gone the moment the first cards
 * land. While it is in front the floating sync pill steps aside, so the counts
 * are on screen once.
 *
 * It is meant to be read calmly: the step on one line, the counts on a quieter
 * line under it, moving no faster than once a second however fast the items
 * arrive. A new step is named at once, with its own counts.
 *
 * The step line is the only progress on the Feed while this shows, so it
 * reaches a screen reader the way the sync strip's line does: a polite live
 * region on Android, and on iOS, which has none, an announcement of the step's
 * label, so a new step is spoken and a moving count inside one is not. The
 * spinner is the busy progress bar a screen reader lands on, valued from the
 * step's own counts when it has them.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Spinner } from '@/shared/ui';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { formatSyncProgressParts } from '@/shared/format/syncProgress';
import { useSyncStatus } from '@/shared/native/useSyncStatus';
import type { SyncStatus } from 'veloqrs';
import { progressValue } from '@/shared/ui/ProgressRow';
import { SectionTitle } from '@/shared/ui/SectionTitle';
import { useAnnounceOnAppear } from '@/shared/ui/useAnnounceOnAppear';
import { useThrottledValue } from '@/shared/ui/useThrottledValue';
import { colors, darkColors, spacing, typography } from '@/theme';

/** The least time between two changes of the counts. */
export const FIRST_SYNC_COUNT_PACE_MS = 1000;

/**
 * The status with its counts held to `FIRST_SYNC_COUNT_PACE_MS`. The step is
 * held with them, so a new step passes at once with its own counts rather than
 * waiting under the last step's.
 */
function usePacedCounts(status: SyncStatus | null): SyncStatus | null {
  // The snapshot is one object per engine announcement, so it changes only
  // when the engine says something did.
  const held = useThrottledValue(status, FIRST_SYNC_COUNT_PACE_MS);
  if (!status || !held || held.step !== status.step) return status;
  return { ...status, completed: held.completed, stepItemsDone: held.stepItemsDone };
}

export function FeedFirstSyncStandby() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const status = usePacedCounts(useSyncStatus());
  const hasStep = status?.step !== undefined;
  const itemsTotal = hasStep ? (status?.stepItemsTotal ?? 0) : 0;
  const line = hasStep ? formatSyncProgressParts(status, t) : null;
  useAnnounceOnAppear(line?.label ?? null);

  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;

  return (
    <View style={styles.container} testID="feed-first-sync-standby">
      <Spinner
        size="large"
        label={t('feed.firstSyncTitle')}
        progress={itemsTotal > 0 ? progressValue(status?.stepItemsDone ?? 0, itemsTotal) : true}
      />
      <SectionTitle align="center" testID="feed-first-sync-title">
        {t('feed.firstSyncTitle')}
      </SectionTitle>
      <Text style={[styles.body, { color: textSecondary }]} testID="feed-first-sync-body">
        {t('feed.firstSyncBody')}
      </Text>
      {line ? (
        <Text
          style={[styles.step, { color: textSecondary }]}
          testID="feed-first-sync-step"
          accessibilityLiveRegion="polite"
        >
          {line.label}
        </Text>
      ) : null}
      {line?.counts ? (
        <Text style={[styles.counts, { color: textSecondary }]} testID="feed-first-sync-counts">
          {line.counts}
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
  counts: {
    ...typography.caption,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
});
