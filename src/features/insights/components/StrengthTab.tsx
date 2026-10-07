import React, { useState, useCallback, useMemo } from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ExtendedBodyPart } from 'react-native-body-highlighter';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { useAthlete } from '@/shared/app/useAthlete';
import {
  useStrengthScreenData,
  buildStrengthBalancePairs,
  selectExercises,
  selectProgression,
  StrengthBodyDiagram,
  StrengthProgressionCard,
  StrengthExerciseList,
  StrengthBalanceView,
  STRENGTH_PERIODS,
} from '@/features/strength';
import { ErrorStatePreset, TAB_BAR_SAFE_PADDING } from '@/shared/ui';
import { engineErrorKey } from '@/shared/native/engineError';
import { useSyncState } from '@/shared/native/useSyncStatus';
import { SyncState } from 'veloqrs';
import { colors, darkColors, spacing, typography, opacity, layout } from '@/theme';
import type { StrengthPeriod, MuscleVolume } from '@/types';
import { PERIOD_LABEL_KEYS, DEFAULT_PERIOD } from '@/shared/app/period';

interface StrengthTabProps {
  /**
   * The engine knows of strength activities whose FIT has never been fetched,
   * and nothing is cached yet. The tab is shown anyway, because hiding it left
   * no surface from which the fetch could be retried.
   */
  awaitingDownload?: boolean;
}

export const StrengthTab = React.memo(function StrengthTab({
  awaitingDownload = false,
}: StrengthTabProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const { data: athlete } = useAthlete();
  const [period, setPeriod] = useState<StrengthPeriod>(DEFAULT_PERIOD);
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

  // Compute body diagram data with heat-map intensity + selection stroke
  const bodyData: ExtendedBodyPart[] = useMemo(() => {
    if (!summary || summary.muscleVolumes.length === 0) return [];
    const maxWeighted = Math.max(...summary.muscleVolumes.map((v) => v.weightedSets));
    if (maxWeighted === 0) return [];

    return summary.muscleVolumes.map((v) => {
      const normalized = v.weightedSets / maxWeighted;
      const intensity = Math.max(1, Math.min(5, Math.ceil(normalized * 5)));
      return {
        slug: v.slug as NonNullable<ExtendedBodyPart['slug']>,
        intensity,
      };
    });
  }, [summary]);

  const maxWeightedSets = useMemo(() => {
    if (!summary || summary.muscleVolumes.length === 0) return 0;
    return Math.max(...summary.muscleVolumes.map((v) => v.weightedSets));
  }, [summary]);

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
  const periodDownloading = periodAwaitingDownload && isSyncing;

  return (
    <ScrollView
      testID="strength-tab"
      style={styles.container}
      contentContainerStyle={[styles.scrollContent, { paddingBottom: TAB_BAR_SAFE_PADDING + 16 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Period selector */}
      <View style={styles.periodRow}>
        {STRENGTH_PERIODS.map((p) => (
          <TouchableOpacity
            key={p.id}
            testID={`strength-period-${p.id}`}
            style={[
              styles.periodButton,
              isDark && styles.periodButtonDark,
              period === p.id && styles.periodButtonActive,
            ]}
            onPress={() => setPeriod(p.id)}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.periodText,
                isDark && styles.periodTextDark,
                period === p.id && styles.periodTextActive,
              ]}
            >
              {t(p.labelKey as never)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      ) : isError ? (
        <View testID="strength-failed">
          <ErrorStatePreset
            message={t(engineErrorKey(error, 'engine.failure.database'))}
            onRetry={() => void refetch()}
          />
        </View>
      ) : !summary || summary.activityCount === 0 ? (
        <View style={styles.emptyContainer} testID="strength-empty">
          {periodDownloading ? (
            <ActivityIndicator size="small" color={colors.primary} testID="strength-downloading" />
          ) : (
            <MaterialCommunityIcons
              name={periodAwaitingDownload ? 'cloud-download-outline' : 'dumbbell'}
              size={32}
              color={isDark ? darkColors.textMuted : colors.textDisabled}
            />
          )}
          <Text style={[styles.emptyText, isDark && styles.emptyTextDark]}>
            {periodDownloading
              ? t('strength.downloading')
              : periodAwaitingDownload
                ? t('strength.notDownloaded')
                : t('strength.noWorkouts', { period: periodLabel })}
          </Text>
          <Text style={[styles.emptyHint, isDark && styles.emptyTextDark]}>
            {periodDownloading
              ? t('strength.downloadingHint')
              : periodAwaitingDownload
                ? t('strength.notDownloadedHint')
                : t('strength.noWorkoutsHint')}
          </Text>
        </View>
      ) : (
        <>
          {(screen?.owedCount ?? 0) > 0 && (
            <View style={styles.owedRow} testID="strength-period-owed">
              <MaterialCommunityIcons
                name="cloud-download-outline"
                size={typography.caption.fontSize}
                color={isDark ? darkColors.textMuted : colors.textSecondary}
              />
              <Text style={[styles.owedText, isDark && styles.emptyTextDark]}>
                {t('strength.periodOwed', { count: screen?.owedCount ?? 0 })}
              </Text>
            </View>
          )}
          <StrengthBodyDiagram
            bodyData={bodyData}
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
          {selectedVolume && (
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
          )}

          <StrengthBalanceView
            visibleBalancePairs={visibleBalancePairs}
            featuredBalancePair={featuredBalancePair}
            periodLabel={periodLabel}
          />

          {/* Info card */}
          <View style={[styles.infoCard, isDark && styles.infoCardDark]}>
            <View style={styles.infoRow}>
              <MaterialCommunityIcons
                name="scale-balance"
                size={14}
                color={isDark ? darkColors.textMuted : colors.textDisabled}
              />
              <Text style={[styles.infoText, isDark && styles.infoTextDark]}>
                {t('strength.infoWeighting')}
              </Text>
            </View>
          </View>

          {/* Disclaimer */}
          <Text style={[styles.disclaimerText, isDark && styles.disclaimerTextDark]}>
            {t(
              'strength.disclaimer',
              'Volume calculations are approximations based on exercise data from your connected device.'
            )}
          </Text>
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
  periodButton: {
    paddingHorizontal: spacing.smPlus,
    paddingVertical: spacing.xs,
    borderRadius: layout.borderRadius,
    backgroundColor: opacity.overlay.light,
  },
  periodButtonDark: {
    backgroundColor: opacity.overlayDark.medium,
  },
  periodButtonActive: {
    backgroundColor: colors.primary,
  },
  periodText: {
    ...typography.caption,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  periodTextDark: {
    color: darkColors.textSecondary,
  },
  periodTextActive: {
    color: colors.textOnPrimary,
  },
  loadingContainer: {
    paddingVertical: spacing.xxl,
    alignItems: 'center',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
    gap: spacing.sm,
  },
  emptyText: {
    fontSize: typography.bodyCompact.fontSize,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  emptyHint: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  owedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  owedText: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
  emptyTextDark: {
    color: darkColors.textSecondary,
  },
  infoCard: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    padding: layout.cardPadding,
    marginBottom: spacing.md,
  },
  infoCardDark: {
    backgroundColor: darkColors.surface,
  },
  infoRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  infoText: {
    flex: 1,
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  infoTextDark: {
    color: darkColors.textSecondary,
  },
  disclaimerText: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  disclaimerTextDark: {
    color: darkColors.textSecondary,
  },
});
