import React, { useState } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { Button } from '@/shared/ui';
import { getPhaseDisplayName } from '@/features/routes';
import { formatClockOrDate } from '@/shared/format/format';
import {
  useBackgroundJobs,
  type BackgroundJob,
  type BackgroundJobRun,
  type BackgroundJobId,
} from '@/features/settings/hooks/useBackgroundJobs';
import { colors, darkColors, spacing, typography, layout } from '@/theme';

const ICONS: Record<BackgroundJobId, React.ComponentProps<typeof MaterialCommunityIcons>['name']> =
  {
    detection: 'map-marker-path',
    elevationBackfill: 'terrain',
    cutover: 'autorenew',
    streamBackfill: 'chart-line',
  };

const TITLE_KEYS = {
  detection: 'backgroundJobs.detection',
  elevationBackfill: 'backgroundJobs.elevationBackfill',
  cutover: 'backgroundJobs.cutover',
  streamBackfill: 'settings.streamBackfill',
} as const satisfies Record<BackgroundJobId, string>;

/**
 * What a resting row rests on, per job.
 *
 * The count is not the same thing for each of them. The download counts tracks
 * it has yet to fetch, the stream pass counts activities owed a series,
 * detection counts activities it has never looked at, and
 * the rebuild is one unit of work that fetches nothing at all. One shared line
 * said "still to fetch" for all three, so a resting rebuild read "1 still to
 * fetch".
 */
const WAITING_KEYS = {
  detection: 'backgroundJobs.detectionWaiting',
  elevationBackfill: 'backgroundJobs.remaining',
  cutover: 'backgroundJobs.cutoverWaiting',
  streamBackfill: 'settings.streamBackfillOwed',
} as const satisfies Record<BackgroundJobId, string>;

/** What a run's items are called, per job. */
const HANDLED_KEYS = {
  detection: 'backgroundJobs.lastRunActivities',
  elevationBackfill: 'backgroundJobs.lastRunActivities',
  cutover: 'backgroundJobs.lastRunSections',
  streamBackfill: 'backgroundJobs.lastRunActivities',
} as const satisfies Record<BackgroundJobId, string>;

/** How a run that did not complete ended. A complete run says nothing more. */
const OUTCOME_KEYS: Record<
  string,
  | 'backgroundJobs.statePartial'
  | 'backgroundJobs.stateFailed'
  | 'backgroundJobs.statePaused'
  | 'backgroundJobs.lastRunStopped'
  | undefined
> = {
  partial: 'backgroundJobs.statePartial',
  failed: 'backgroundJobs.stateFailed',
  paused: 'backgroundJobs.statePaused',
  stopped: 'backgroundJobs.lastRunStopped',
};

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
    return t(WAITING_KEYS[job.id], { count: job.remaining });
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

/**
 * The job's last run: when it finished, how many it handled and what changed,
 * naming only the counts that are not zero. A complete run that changed
 * nothing says so; a run that did not finish says how it ended.
 */
function useLastRunLine(job: BackgroundJob): string | null {
  const { t } = useTranslation();
  const run: BackgroundJobRun | null = job.lastRun;
  if (!run) return null;

  const parts = [formatClockOrDate(run.finishedAt)];
  const outcome = OUTCOME_KEYS[run.outcome];
  if (outcome) parts.push(t(outcome));
  if (run.handled > 0) {
    parts.push(t(HANDLED_KEYS[job.id], { count: run.handled }));
  }
  const changes = [
    run.added > 0 ? t('backgroundJobs.lastRunAdded', { count: run.added }) : null,
    run.changed > 0 ? t('backgroundJobs.lastRunChanged', { count: run.changed }) : null,
    run.retired > 0 ? t('backgroundJobs.lastRunRetired', { count: run.retired }) : null,
    run.failed > 0 ? t('backgroundJobs.lastRunFailed', { count: run.failed }) : null,
  ].filter((change): change is string => change !== null);
  if (changes.length > 0) {
    parts.push(changes.join(', '));
  } else if (run.outcome === 'complete') {
    parts.push(t('backgroundJobs.lastRunNoChange'));
  }
  return parts.join(' · ');
}

function JobRow({ job }: { job: BackgroundJob }) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const detail = useDetail(job);
  const lastRun = useLastRunLine(job);

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
        {lastRun ? (
          <Text
            style={[styles.detail, { color: textSecondary }]}
            testID={`background-job-${job.id}-last-run`}
          >
            {lastRun}
          </Text>
        ) : null}
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

export function BackgroundJobsActivityBar() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const jobs = useBackgroundJobs();
  const [expanded, setExpanded] = useState(false);
  const active = jobs.filter((job) => job.state === 'running' || (job.remaining ?? 0) > 0);
  const listed = jobs.filter(
    (job) => job.state === 'running' || (job.remaining ?? 0) > 0 || job.lastRun !== null
  );

  if (listed.length === 0) return null;

  // At rest the bar names when the newest run finished; while a job runs or
  // owes work it counts them.
  const newest = Math.max(0, ...jobs.map((job) => job.lastRun?.finishedAt ?? 0));
  const summary =
    active.length > 0
      ? String(active.length)
      : t('backgroundJobs.lastFinished', { time: formatClockOrDate(newest) });

  return (
    <View testID="background-jobs-activity" style={[styles.card, isDark && styles.cardDark]}>
      <Button
        testID="background-jobs-activity-toggle"
        label={`${t('backgroundJobs.title')} · ${summary}`}
        variant="secondary"
        size="sm"
        onPress={() => setExpanded((value) => !value)}
        icon={
          <MaterialCommunityIcons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={20}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
        }
        style={styles.toggle}
      />
      {expanded
        ? listed.map((job, index) => (
            <View key={job.id}>
              {index > 0 ? <View style={[styles.divider, isDark && styles.dividerDark]} /> : null}
              <JobRow job={job} />
            </View>
          ))
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    marginHorizontal: layout.screenPadding,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  cardDark: {
    backgroundColor: darkColors.surface,
  },
  toggle: {
    minHeight: layout.minTapTarget,
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
    gap: spacing.xxs,
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
