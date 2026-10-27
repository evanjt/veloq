import React, { useState, useCallback, useMemo, useRef } from 'react';
import { View, ScrollView, StyleSheet, type ScrollViewInstance } from 'react-native';
import { Text } from 'react-native-paper';
import type { ExtendedBodyPart } from 'react-native-body-highlighter';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { useAthlete } from '@/shared/app/useAthlete';
import {
  useOwedStrengthFiles,
  useStrengthScreenData,
  buildStrengthBalancePairs,
  selectExercises,
  selectProgression,
  StrengthBodyDiagram,
  StrengthBodyDiagramSkeleton,
  StrengthProgressionCard,
  StrengthExerciseList,
  StrengthBalanceView,
  STRENGTH_PERIODS,
} from '@/features/strength';
import {
  BodyNotDownloaded,
  EmptyState,
  ErrorState,
  ExplanationCard,
  ToggleButton,
  useScrollEndInset,
  Spinner,
} from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import { ScreenRefreshControl } from '@/shared/ui/ScreenRefreshControl';
import { useScrollToTopOnReselect } from '@/shared/ui/tabReselect';
import { useSyncState } from '@/shared/native/useSyncStatus';
import { SyncState } from 'veloqrs';
import { colors, darkColors, iconSize, spacing, typography } from '@/theme';
import type { StrengthPeriod, MuscleVolume } from '@/types';
import { PERIOD_LABEL_KEYS, DEFAULT_PERIOD } from '@/shared/app/period';
import { strengthExplanation } from '../lib/aboutCopy';

interface StrengthTabProps {
  /**
   * The engine knows of strength activities whose FIT has never been fetched,
   * and nothing is cached yet. The tab is shown anyway, because hiding it left
   * no surface from which the fetch could be retried.
   */
  awaitingDownload?: boolean;
  /**
   * The period a link asked for. Each link is a new object, so a second link
   * applies even when it names the period the tab already left; between links
   * the athlete's own choice stands.
   */
  linkedPeriod?: { period: StrengthPeriod } | undefined;
  /** Called when the athlete pulls the page down; without it the page offers no refresh */
  onRefresh?: (() => unknown) | undefined;
  /** A refresh or the sync it asked for is running */
  refreshing?: boolean | undefined;
}

export const StrengthTab = React.memo(function StrengthTab({
  awaitingDownload = false,
  linkedPeriod,
  onRefresh,
  refreshing = false,
}: StrengthTabProps) {
  const { isDark } = useTheme();
  const scrollEndInset = useScrollEndInset();
  const scrollRef = useRef<ScrollViewInstance>(null);
  useScrollToTopOnReselect('/insights', scrollRef);
  const { t } = useTranslation();
  const { data: athlete } = useAthlete();
  const [period, setPeriod] = useState<StrengthPeriod>(linkedPeriod?.period ?? DEFAULT_PERIOD);
  // Applied during render rather than in an effect, so the tab never reads the
  // period it is leaving.
  const [appliedLink, setAppliedLink] = useState(linkedPeriod);
  if (linkedPeriod !== appliedLink) {
    setAppliedLink(linkedPeriod);
    if (linkedPeriod) setPeriod(linkedPeriod.period);
  }
  const [selectedMuscle, setSelectedMuscle] = useState<string | null>(null);

  const { data: screen, isLoading, isError, error, refetch } = useStrengthScreenData(period);
  const summary = screen?.summary;
  const progression = useMemo(
    () => selectProgression(screen, selectedMuscle),
    [screen, selectedMuscle]
  );
  const exerciseSummary = useMemo(
    () => selectExercises(screen, selectedMuscle),
    [screen, selectedMuscle]
  );

  const gender = athlete?.sex === 'F' ? 'female' : 'male';

  const bodyData: ExtendedBodyPart[] = useMemo(
    () =>
      (summary?.muscleVolumes ?? []).map((v) => ({
        slug: v.slug as NonNullable<ExtendedBodyPart['slug']>,
        intensity: v.shade,
      })),
    [summary]
  );
  const maxWeightedSets = summary?.maxWeightedSets ?? 0;

  const selectedVolume: MuscleVolume | null = useMemo(() => {
    if (!selectedMuscle || !summary) return null;
    return summary.muscleVolumes.find((v) => v.slug === selectedMuscle) ?? null;
  }, [selectedMuscle, summary]);

  const balancePairs = useMemo(
    () => buildStrengthBalancePairs(summary?.balance ?? [], t),
    [summary, t]
  );

  const visibleBalancePairs = useMemo(
    () => balancePairs.filter((pair) => pair.status !== 'insufficient'),
    [balancePairs]
  );

  const featuredBalancePair = visibleBalancePairs[0] ?? null;
  const hasRecentProgression = progression ? progression.peakWeightedSets > 0 : false;
  const maxProgressWeightedSets = Math.max(progression?.peakWeightedSets ?? 0, 1);

  const handleMuscleTap = useCallback((slug: string) => {
    setSelectedMuscle((prev) => (prev === slug ? null : slug));
  }, []);

  const handleMuscleScrub = useCallback((slug: string) => {
    setSelectedMuscle(slug);
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedMuscle(null);
  }, []);

  const tappableSlugs = useMemo(
    () => new Set((summary?.muscleVolumes ?? []).map((v) => v.slug)),
    [summary]
  );

  const periodLabel = t(PERIOD_LABEL_KEYS.long[period] as never);
  // An empty period with sessions still owed their files has workouts it
  // cannot show yet, which is not the same as having none.
  const periodAwaitingDownload = awaitingDownload || (screen?.owedCount ?? 0) > 0;
  const isSyncing = useSyncState() === SyncState.Syncing;
  // Asked for only while the empty state is what shows: a populated period
  // names its owed count and leaves the files to the sync.
  const showsEmpty = !isLoading && !isError && (!summary || summary.activityCount === 0);
  const owedFiles = useOwedStrengthFiles(periodAwaitingDownload && showsEmpty);
  const periodDownloading = periodAwaitingDownload && (isSyncing || owedFiles.status === 'waiting');

  return (
    <ScrollView
      ref={scrollRef}
      testID="strength-tab"
      focusable={false}
      style={styles.container}
      contentContainerStyle={[styles.scrollContent, { paddingBottom: scrollEndInset + 16 }]}
      showsVerticalScrollIndicator={false}
      refreshControl={
        onRefresh ? (
          <ScreenRefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        ) : undefined
      }
    >
      {/* Period selector */}
      <View style={styles.periodRow}>
        {STRENGTH_PERIODS.map((p) => (
          <ToggleButton
            key={p.id}
            testID={`strength-period-${p.id}`}
            label={t(p.labelKey as never)}
            selected={period === p.id}
            onPress={() => setPeriod(p.id)}
          />
        ))}
      </View>

      {isLoading ? (
        <StrengthBodyDiagramSkeleton />
      ) : isError ? (
        <View testID="strength-failed">
          <ErrorState
            error={error}
            fallbackKey="engine.failure.database"
            onRetry={() => void refetch()}
          />
        </View>
      ) : !summary || summary.activityCount === 0 ? (
        periodDownloading ? (
          <View style={styles.loadingContainer}>
            <Spinner label={t('strength.downloading')} testID="strength-downloading" />
            <EmptyState
              variant="inline"
              title={t('strength.downloading')}
              description={t('strength.downloadingHint')}
            />
          </View>
        ) : periodAwaitingDownload ? (
          <View style={styles.notDownloadedContainer} testID="strength-empty">
            <Icon
              name="cloud-download-outline"
              size={iconSize.xl}
              color={isDark ? darkColors.textSecondary : colors.textSecondary}
            />
            <BodyNotDownloaded
              testID="strength-not-downloaded"
              style={styles.notDownloaded}
              textStyle={[styles.notDownloadedText, isDark && styles.notDownloadedTextDark]}
              message={t('strength.notDownloaded')}
              status={owedFiles.status}
              onRetry={owedFiles.retry}
            />
          </View>
        ) : (
          <EmptyState
            variant="compact"
            testID="strength-empty"
            icon="dumbbell"
            title={t('strength.noWorkouts', { period: periodLabel })}
            description={t('strength.noWorkoutsHint')}
          />
        )
      ) : (
        <>
          {(screen?.owedCount ?? 0) > 0 && (
            <View style={styles.owedRow} testID="strength-period-owed">
              <Icon
                name="cloud-download-outline"
                size={iconSize.sm}
                color={isDark ? darkColors.textSecondary : colors.textSecondary}
              />
              <Text style={[styles.owedText, isDark && styles.owedTextDark]}>
                {t('strength.periodOwed', { count: screen?.owedCount ?? 0 })}
              </Text>
            </View>
          )}
          <StrengthBodyDiagram
            bodyData={bodyData}
            volumes={summary?.muscleVolumes}
            gender={gender}
            maxWeightedSets={maxWeightedSets}
            selectedVolume={selectedVolume}
            tappableSlugs={tappableSlugs}
            onMuscleTap={handleMuscleTap}
            onMuscleScrub={handleMuscleScrub}
            onClearSelection={handleClearSelection}
          />

          {/* The period totals show for any muscle the period reached. The
              four-week figures inside the card need the last four weeks to
              have reached it too. */}
          {selectedVolume ? (
            <StrengthProgressionCard
              selectedVolume={selectedVolume}
              progression={hasRecentProgression ? progression : null}
              maxProgressWeightedSets={maxProgressWeightedSets}
              exerciseSummary={exerciseSummary}
              periodLabel={periodLabel}
            >
              {exerciseSummary.exercises.length > 0 ? (
                <StrengthExerciseList
                  selectedVolume={selectedVolume}
                  exerciseSummary={exerciseSummary}
                />
              ) : null}
            </StrengthProgressionCard>
          ) : null}

          <StrengthBalanceView
            visibleBalancePairs={visibleBalancePairs}
            featuredBalancePair={featuredBalancePair}
            periodLabel={periodLabel}
          />

          <ExplanationCard {...strengthExplanation(t)} testID="strength-explanation" />
        </>
      )}
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  periodRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  loadingContainer: {
    paddingVertical: spacing.xxl,
    alignItems: 'center',
  },
  notDownloadedContainer: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
    gap: spacing.sm,
  },
  notDownloaded: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  notDownloadedText: {
    ...typography.bodyCompact,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  notDownloadedTextDark: {
    color: darkColors.textSecondary,
  },
  owedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  owedText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  owedTextDark: {
    color: darkColors.textSecondary,
  },
});
