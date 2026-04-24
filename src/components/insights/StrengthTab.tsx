import React, { useState, useCallback, useMemo } from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ExtendedBodyPart } from 'react-native-body-highlighter';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks';
import {
  useStrengthVolume,
  useStrengthProgression,
  useExercisesForMuscle,
  useActivitiesForExercise,
} from '@/hooks/activities/useStrengthVolume';
import { useAthlete } from '@/hooks';
import { buildStrengthBalancePairs } from '@/lib/strength/analysis';
import { TAB_BAR_SAFE_PADDING } from '@/components/ui';
import { colors, darkColors, spacing, typography, opacity, layout } from '@/theme';
import type { StrengthPeriod, MuscleVolume } from '@/types';
import {
  StrengthBodyDiagram,
  StrengthProgressionCard,
  StrengthExerciseList,
  StrengthBalanceView,
} from './strength';

const PERIODS: { id: StrengthPeriod; label: string }[] = [
  { id: 'week', label: '7D' },
  { id: '4weeks', label: '4W' },
  { id: '3months', label: '3M' },
  { id: '6months', label: '6M' },
];

export const StrengthTab = React.memo(function StrengthTab() {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const { data: athlete } = useAthlete();
  const [period, setPeriod] = useState<StrengthPeriod>('4weeks');
  const [selectedMuscle, setSelectedMuscle] = useState<string | null>(null);
  const [expandedExercise, setExpandedExercise] = useState<number | null>(null);

  const { data: summary, isLoading } = useStrengthVolume(period);
  const { data: progression } = useStrengthProgression(selectedMuscle);
  const { data: exerciseSummary } = useExercisesForMuscle(period, selectedMuscle);
  const { data: exerciseActivities } = useActivitiesForExercise(
    period,
    selectedMuscle,
    expandedExercise
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
        slug: v.slug as ExtendedBodyPart['slug'],
        intensity,
        ...(v.slug === selectedMuscle ? { styles: { stroke: '#1A1A1A', strokeWidth: 2.5 } } : {}),
      };
    });
  }, [summary, selectedMuscle]);

  const maxWeightedSets = useMemo(() => {
    if (!summary || summary.muscleVolumes.length === 0) return 0;
    return Math.max(...summary.muscleVolumes.map((v) => v.weightedSets));
  }, [summary]);

  const selectedVolume: MuscleVolume | null = useMemo(() => {
    if (!selectedMuscle || !summary) return null;
    return summary.muscleVolumes.find((v) => v.slug === selectedMuscle) ?? null;
  }, [selectedMuscle, summary]);

  const balancePairs = useMemo(
    () => buildStrengthBalancePairs(summary?.muscleVolumes ?? []),
    [summary]
  );

  const visibleBalancePairs = useMemo(
    () => balancePairs.filter((pair) => pair.status !== 'insufficient'),
    [balancePairs]
  );

  const featuredBalancePair = visibleBalancePairs[0] ?? null;
  const hasRecentProgression = progression
    ? progression.points.some((point) => point.weightedSets > 0)
    : false;
  const maxProgressWeightedSets = useMemo(() => {
    if (!progression) return 1;
    return Math.max(...progression.points.map((point) => point.weightedSets), 1);
  }, [progression]);

  const handleMuscleTap = useCallback((slug: string) => {
    setSelectedMuscle((prev) => (prev === slug ? null : slug));
    setExpandedExercise(null);
  }, []);

  const handleMuscleScrub = useCallback((slug: string) => {
    setSelectedMuscle(slug);
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedMuscle(null);
  }, []);

  const handleExpandExercise = useCallback((exerciseCategory: number | null) => {
    setExpandedExercise(exerciseCategory);
  }, []);

  const tappableSlugs = useMemo(
    () => new Set((summary?.muscleVolumes ?? []).map((v) => v.slug)),
    [summary]
  );

  const periodLabels: Record<StrengthPeriod, string> = {
    week: t('strength.periodWeek'),
    '4weeks': t('strength.period4Weeks'),
    '3months': t('strength.period3Months'),
    '6months': t('strength.period6Months'),
  };
  const periodLabel = periodLabels[period];

  return (
    <ScrollView
      testID="strength-tab"
      style={styles.container}
      contentContainerStyle={[styles.scrollContent, { paddingBottom: TAB_BAR_SAFE_PADDING + 16 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Period selector */}
      <View style={styles.periodRow}>
        {PERIODS.map((p) => (
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
              {p.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      ) : !summary || summary.activityCount === 0 ? (
        <View style={styles.emptyContainer}>
          <MaterialCommunityIcons
            name="dumbbell"
            size={32}
            color={isDark ? darkColors.textMuted : colors.textDisabled}
          />
          <Text style={[styles.emptyText, isDark && styles.emptyTextDark]}>
            {t('strength.noWorkouts', { period: periodLabel })}
          </Text>
          <Text style={[styles.emptyHint, isDark && styles.emptyTextDark]}>
            {t('strength.noWorkoutsHint')}
          </Text>
        </View>
      ) : (
        <>
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

          {selectedVolume && progression && hasRecentProgression && (
            <StrengthProgressionCard
              selectedVolume={selectedVolume}
              progression={progression}
              maxProgressWeightedSets={maxProgressWeightedSets}
              exerciseSummary={exerciseSummary ?? null}
              periodLabel={periodLabel}
            >
              {exerciseSummary && exerciseSummary.exercises.length > 0 ? (
                <StrengthExerciseList
                  selectedVolume={selectedVolume}
                  exerciseSummary={exerciseSummary}
                  expandedExercise={expandedExercise}
                  exerciseActivities={exerciseActivities ?? null}
                  onExpandExercise={handleExpandExercise}
                  embedded
                />
              ) : null}
            </StrengthProgressionCard>
          )}

          {/* Render exercise list as a standalone card only when there is no
              progression card to embed it into. */}
          {selectedVolume &&
            (!progression || !hasRecentProgression) &&
            exerciseSummary &&
            exerciseSummary.exercises.length > 0 && (
              <StrengthExerciseList
                selectedVolume={selectedVolume}
                exerciseSummary={exerciseSummary}
                expandedExercise={expandedExercise}
                exerciseActivities={exerciseActivities ?? null}
                onExpandExercise={handleExpandExercise}
              />
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
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.xs,
    borderRadius: 14,
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
    color: colors.textOnDark,
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
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  emptyHint: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
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
