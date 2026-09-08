/**
 * Every long-running job, listed always.
 *
 * A job that is not running keeps its row and reads as resting, because the
 * scattered surfaces this replaces all vanished the moment their job settled,
 * which is exactly when a user goes looking for them. Where a resting job can
 * say how much work is waiting, it does.
 */

import React from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { getPhaseDisplayName } from '@/features/routes/lib/detectionProgress';
import {
  useBackgroundJobs,
  type BackgroundJob,
  type BackgroundJobId,
} from '@/features/settings/hooks/useBackgroundJobs';
import { colors, darkColors, spacing, typography, layout } from '@/theme';

const ICONS: Record<BackgroundJobId, React.ComponentProps<typeof MaterialCommunityIcons>['name']> =
  {
    sync: 'sync',
    detection: 'map-marker-path',
    elevationBackfill: 'terrain',
    cutover: 'autorenew',
  };

const TITLE_KEYS = {
  sync: 'backgroundJobs.sync',
  detection: 'backgroundJobs.detection',
  elevationBackfill: 'backgroundJobs.elevationBackfill',
  cutover: 'backgroundJobs.cutover',
} as const satisfies Record<BackgroundJobId, string>;

/** The detail line under a job's title: what it is doing, or what waits. */
function useDetail(job: BackgroundJob): string {
  const { t } = useTranslation();

  if (job.state === 'running') {
    if (job.id === 'detection' && job.phase) {
      return job.percent === null
        ? getPhaseDisplayName(job.phase)
        : `${getPhaseDisplayName(job.phase)} · ${t('backgroundJobs.progressPercent', {
            percent: Math.round(job.percent),
          })}`;
    }
    if (job.id === 'cutover' && job.phase) return getPhaseDisplayName(job.phase);
    if (job.total > 0) {
      return t('backgroundJobs.progressCount', { completed: job.completed, total: job.total });
    }
    return t('backgroundJobs.stateRunning');
  }

  if (job.state === 'idle' && job.remaining !== null && job.remaining > 0) {
    // The count is what a resting row rests on, and the rebuild is the one job
    // that counts something other than a download: it is one unit of work and
    // it fetches nothing, so the shared "still to fetch" line is wrong for it.
    return job.id === 'cutover'
      ? t('backgroundJobs.cutoverWaiting')
      : t('backgroundJobs.remaining', { count: job.remaining });
  }

  switch (job.state) {
    case 'complete':
      return t('backgroundJobs.stateComplete');
    case 'partial':
      return t('backgroundJobs.statePartial');
    case 'failed':
      return t('backgroundJobs.stateFailed');
    case 'paused':
      return t('backgroundJobs.statePaused');
    default:
      return t('backgroundJobs.stateIdle');
  }
}

function JobRow({ job }: { job: BackgroundJob }) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const detail = useDetail(job);

  const textPrimary = isDark ? colors.textOnDark : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const danger = isDark ? darkColors.error : colors.error;

  return (
    <View style={styles.row} testID={`background-job-${job.id}`}>
      <MaterialCommunityIcons name={ICONS[job.id]} size={22} color={textSecondary} />
      <View style={styles.rowText}>
        <Text style={[styles.title, { color: textPrimary }]}>{t(TITLE_KEYS[job.id])}</Text>
        <Text
          style={[styles.detail, { color: job.state === 'failed' ? danger : textSecondary }]}
          testID={`background-job-${job.id}-detail`}
        >
          {detail}
        </Text>
      </View>
      {job.state === 'running' ? (
        <ActivityIndicator
          size="small"
          color={textSecondary}
          testID={`background-job-${job.id}-spinner`}
        />
      ) : null}
    </View>
  );
}

export function BackgroundJobsPanel() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const jobs = useBackgroundJobs();

  return (
    <View testID="background-jobs-panel">
      <Text
        style={[styles.intro, { color: isDark ? darkColors.textSecondary : colors.textSecondary }]}
      >
        {t('backgroundJobs.intro')}
      </Text>
      <View style={[styles.card, isDark && styles.cardDark]}>
        {jobs.map((job, index) => (
          <View key={job.id}>
            {index > 0 ? <View style={[styles.divider, isDark && styles.dividerDark]} /> : null}
            <JobRow job={job} />
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  intro: {
    ...typography.bodySmall,
    paddingHorizontal: layout.screenPadding,
    marginBottom: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    marginHorizontal: layout.screenPadding,
    overflow: 'hidden',
  },
  cardDark: {
    backgroundColor: darkColors.surface,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: layout.minTapTarget,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...typography.body,
  },
  detail: {
    ...typography.bodySmall,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginLeft: spacing.md,
  },
  dividerDark: {
    backgroundColor: darkColors.border,
  },
});
