import React, { useState, useCallback, useMemo } from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ExtendedBodyPart } from 'react-native-body-highlighter';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { useTheme, useMetricSystem } from '@/hooks';
import {
  useStrengthVolume,
  useStrengthProgression,
  useExercisesForMuscle,
  useActivitiesForExercise,
} from '@/hooks/activities/useStrengthVolume';
import { useAthlete } from '@/hooks';
import { buildStrengthBalancePairs } from '@/lib/strength/analysis';
import { formatSetCount } from '@/lib/strength/formatting';
import { MUSCLE_DISPLAY_NAMES, type MuscleSlug } from '@/lib/strength/exerciseMuscleMap';
import { TAB_BAR_SAFE_PADDING } from '@/components/ui';
import { colors, darkColors, spacing, typography, opacity, layout, brand } from '@/theme';
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
  const isMetric = useMetricSystem();
  const { data: athlete } = useAthlete();
  const [period, setPeriod] = useState<StrengthPeriod>('4weeks');
  const [selectedMuscle, setSelectedMuscle] = useState<string | null>(null);
  const [expandedExercise, setExpandedExercise] = useState<number | null>(null);
  const [showMuscleDetails, setShowMuscleDetails] = useState(false);

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

  const topMuscle = useMemo(() => {
    if (!summary || summary.muscleVolumes.length === 0) return null;
    return [...summary.muscleVolumes].sort((a, b) => b.weightedSets - a.weightedSets)[0] ?? null;
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
    setSelectedMuscle((prev) => {
      const next = prev === slug ? null : slug;
      if (!next) setShowMuscleDetails(false);
      return next;
    });
    setExpandedExercise(null);
  }, []);

  const handleMuscleScrub = useCallback((slug: string) => {
    setSelectedMuscle(slug);
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedMuscle(null);
    setShowMuscleDetails(false);
  }, []);

  const handleToggleDetails = useCallback(() => {
    setShowMuscleDetails((prev) => !prev);
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
  const selectedMuscleName = selectedVolume
    ? (MUSCLE_DISPLAY_NAMES[selectedVolume.slug as MuscleSlug] ?? selectedVolume.slug)
    : '';
  const topMuscleName = topMuscle
    ? (MUSCLE_DISPLAY_NAMES[topMuscle.slug as MuscleSlug] ?? topMuscle.slug)
    : '';
  const heroTitle = selectedVolume
    ? t('strength.muscleInFocus', { muscle: selectedMuscleName })
    : topMuscle
      ? t('strength.muscleStandsOut', { muscle: topMuscleName })
      : t('strength.snapshot');
  const heroObservation = selectedVolume
    ? t('strength.selectedMuscleObservation', {
        muscle: selectedMuscleName,
        sets: formatSetCount(selectedVolume.weightedSets),
        period: periodLabel,
      })
    : topMuscle && featuredBalancePair
      ? t('strength.topMuscleWithBalance', {
          muscle: topMuscleName,
          period: periodLabel,
          pair: featuredBalancePair.label,
        })
      : topMuscle
        ? t('strength.topMuscleOnly', {
            muscle: topMuscleName,
            period: periodLabel,
          })
        : t('strength.defaultObservation', { period: periodLabel });

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
            progression={progression ?? null}
            hasRecentProgression={hasRecentProgression}
            maxProgressWeightedSets={maxProgressWeightedSets}
            exerciseSummary={exerciseSummary ?? null}
            showMuscleDetails={showMuscleDetails}
            tappableSlugs={tappableSlugs}
            onMuscleTap={handleMuscleTap}
            onMuscleScrub={handleMuscleScrub}
            onClearSelection={handleClearSelection}
            onToggleDetails={handleToggleDetails}
          />

          {/* Expanded muscle details */}
          {selectedVolume && showMuscleDetails && (
            <>
              {progression && hasRecentProgression && (
                <StrengthProgressionCard
                  selectedVolume={selectedVolume}
                  progression={progression}
                  maxProgressWeightedSets={maxProgressWeightedSets}
                />
              )}

              {exerciseSummary && exerciseSummary.exercises.length > 0 && (
                <StrengthExerciseList
                  selectedVolume={selectedVolume}
                  exerciseSummary={exerciseSummary}
                  expandedExercise={expandedExercise}
                  exerciseActivities={exerciseActivities ?? null}
                  onExpandExercise={handleExpandExercise}
                />
              )}
            </>
          )}

          {/* Hero summary card */}
          <View style={[styles.heroCard, isDark && styles.heroCardDark]}>
            <LinearGradient
              colors={isDark ? ['#2A1A10', '#181818'] : ['#FFF5EC', '#FFFFFF']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.heroGradient}
            >
              <View style={styles.heroHeader}>
                <Text style={[styles.heroEyebrow, isDark && styles.heroEyebrowDark]}>
                  {t('strength.snapshot')}
                </Text>
                <Text style={[styles.heroTitle, isDark && styles.heroTitleDark]}>{heroTitle}</Text>
                <Text style={[styles.heroBody, isDark && styles.heroBodyDark]}>
                  {heroObservation}
                </Text>
              </View>

              <View style={styles.heroChipRow}>
                <View style={[styles.heroChip, isDark && styles.heroChipDark]}>
                  <Text style={[styles.heroChipValue, isDark && styles.heroChipValueDark]}>
                    {summary.activityCount}
                  </Text>
                  <Text style={[styles.heroChipLabel, isDark && styles.heroChipLabelDark]}>
                    {t('strength.workoutCount_label', {
                      count: summary.activityCount,
                    })}
                  </Text>
                </View>
                <View style={[styles.heroChip, isDark && styles.heroChipDark]}>
                  <Text style={[styles.heroChipValue, isDark && styles.heroChipValueDark]}>
                    {summary.totalSets}
                  </Text>
                  <Text style={[styles.heroChipLabel, isDark && styles.heroChipLabelDark]}>
                    {t('strength.sets')}
                  </Text>
                </View>
                <View style={[styles.heroChip, isDark && styles.heroChipDark]}>
                  <Text style={[styles.heroChipValue, isDark && styles.heroChipValueDark]}>
                    {summary.muscleVolumes.length}
                  </Text>
                  <Text style={[styles.heroChipLabel, isDark && styles.heroChipLabelDark]}>
                    {t('strength.muscleGroups')}
                  </Text>
                </View>
              </View>
            </LinearGradient>
          </View>

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
  heroCard: {
    borderRadius: layout.borderRadius,
    overflow: 'hidden',
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
  },
  heroCardDark: {
    backgroundColor: darkColors.surface,
  },
  heroGradient: {
    padding: spacing.md,
    gap: spacing.md,
  },
  heroHeader: {
    gap: 6,
  },
  heroEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: colors.primary,
  },
  heroEyebrowDark: {
    color: brand.orangeLight,
  },
  heroTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary,
    lineHeight: 24,
  },
  heroTitleDark: {
    color: darkColors.textPrimary,
  },
  heroBody: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSecondary,
  },
  heroBodyDark: {
    color: darkColors.textSecondary,
  },
  heroChipRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  heroChip: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.72)',
    alignItems: 'center',
  },
  heroChipDark: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  heroChipValue: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  heroChipValueDark: {
    color: darkColors.textPrimary,
  },
  heroChipLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  heroChipLabelDark: {
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
