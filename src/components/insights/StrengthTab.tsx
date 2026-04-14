import React, { useState, useCallback, useMemo } from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ExtendedBodyPart } from 'react-native-body-highlighter';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { BodyPairWithLoupe } from '@/components/activity/BodyPairWithLoupe';
import { useTheme, useMetricSystem } from '@/hooks';
import {
  useStrengthVolume,
  useStrengthProgression,
  useExercisesForMuscle,
  useActivitiesForExercise,
} from '@/hooks/activities/useStrengthVolume';
import { useAthlete } from '@/hooks';
import { buildStrengthBalancePairs } from '@/lib/strength/analysis';
import { MUSCLE_DISPLAY_NAMES, type MuscleSlug } from '@/lib/strength/exerciseMuscleMap';
import { TAB_BAR_SAFE_PADDING } from '@/components/ui';
import { colors, darkColors, spacing, typography, opacity, layout, brand } from '@/theme';
import type {
  StrengthPeriod,
  MuscleVolume,
  ExerciseSummary,
  StrengthBalancePair,
  StrengthBalanceStatus,
  StrengthProgression,
} from '@/types';

// 5-step color ramp from light to saturated for continuous heat map
const BODY_COLORS: readonly string[] = [
  '#FDDCC4', // 1 - very light
  brand.orangeLight, // 2 - light orange
  '#FB8C4E', // 3 - medium orange
  '#FC6A1A', // 4 - dark orange
  brand.orange, // 5 - full primary
] as const;
const BODY_FILL_LIGHT = '#3f3f3f';
const BODY_FILL_DARK = '#555555';
const PERIODS: { id: StrengthPeriod; label: string }[] = [
  { id: 'week', label: '7D' },
  { id: '4weeks', label: '4W' },
  { id: '3months', label: '3M' },
  { id: '6months', label: '6M' },
];

function formatWeight(kg: number, isMetric: boolean): string {
  if (isMetric) return `${Math.round(kg)} kg`;
  return `${Math.round(kg * 2.20462)} lbs`;
}

function formatSetCount(sets: number): string {
  return sets % 1 === 0 ? sets.toFixed(0) : sets.toFixed(1);
}

function formatBalanceRatio(pair: StrengthBalancePair): string {
  if (pair.ratio == null || !Number.isFinite(pair.ratio)) return '\u2014';
  return `${pair.ratio.toFixed(pair.ratio >= 10 ? 0 : 1)}x`;
}

export const StrengthTab = React.memo(function StrengthTab() {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const isMetric = useMetricSystem();
  const { data: athlete } = useAthlete();
  const router = useRouter();
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
      // Map 0-1 to intensity 1-5 for the 5-step color ramp
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

  // Find the selected muscle's data
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
      style={styles.container}
      contentContainerStyle={[styles.scrollContent, { paddingBottom: TAB_BAR_SAFE_PADDING + 16 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Period selector */}
      <View style={styles.periodRow}>
        {PERIODS.map((p) => (
          <TouchableOpacity
            key={p.id}
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
          {/* Body diagrams */}
          <View style={[styles.bodyCard, isDark && styles.bodyCardDark]}>
            <View style={styles.bodyHeader}>
              <Text style={[styles.bodyTitle, isDark && styles.bodyTitleDark]}>
                {t('strength.muscleGroupVolume')}
              </Text>
              <Text style={[styles.bodySubtitle, isDark && styles.bodySubtitleDark]}>
                {t('strength.relativeWeightedSets')}
              </Text>
            </View>
            {selectedVolume ? (
              <TouchableOpacity
                style={styles.subtitleRow}
                onPress={() => setSelectedMuscle(null)}
                activeOpacity={0.7}
              >
                <View
                  style={[
                    styles.subtitleDot,
                    {
                      backgroundColor:
                        selectedVolume.primarySets > 0 ? brand.orange : brand.orangeLight,
                    },
                  ]}
                />
                <Text
                  style={[styles.subtitleText, isDark && styles.subtitleTextDark]}
                  numberOfLines={1}
                >
                  {MUSCLE_DISPLAY_NAMES[selectedVolume.slug as MuscleSlug] ?? selectedVolume.slug} ·{' '}
                  {selectedVolume.weightedSets % 1 === 0
                    ? selectedVolume.weightedSets.toFixed(0)
                    : selectedVolume.weightedSets.toFixed(1)}{' '}
                  {t('strength.sets')}
                  {selectedVolume.totalReps > 0
                    ? ` · ${selectedVolume.totalReps} ${t('strength.reps')}`
                    : ''}
                </Text>
                <MaterialCommunityIcons
                  name="close"
                  size={14}
                  color={isDark ? darkColors.textMuted : colors.textDisabled}
                />
              </TouchableOpacity>
            ) : (
              <Text style={[styles.bodyHint, isDark && styles.bodyHintDark]}>
                {t('strength.tapMuscleGroup')}
              </Text>
            )}

            <BodyPairWithLoupe
              data={bodyData}
              gender={gender}
              scale={0.6}
              colors={BODY_COLORS}
              onMuscleTap={handleMuscleTap}
              onMuscleScrub={handleMuscleScrub}
              tappableSlugs={tappableSlugs}
              defaultFill={isDark ? BODY_FILL_DARK : BODY_FILL_LIGHT}
            />

            {/* Continuous scale bar — normalized 0-10 */}
            <View style={styles.scaleBarContainer}>
              <Text style={[styles.scaleLabel, isDark && styles.scaleLabelDark]}>
                {t('strength.relativeVolume')}
              </Text>
              <View style={styles.scaleBar}>
                <LinearGradient
                  colors={[
                    BODY_FILL_LIGHT,
                    '#FDDCC4',
                    brand.orangeLight,
                    '#FB8C4E',
                    '#FC6A1A',
                    brand.orange,
                  ]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.scaleGradient}
                />
              </View>
              <View style={styles.scaleLabels}>
                <Text style={[styles.scaleValue, isDark && styles.scaleValueDark]}>0</Text>
                <Text style={[styles.scaleValue, isDark && styles.scaleValueDark]}>
                  {maxWeightedSets % 1 === 0
                    ? maxWeightedSets.toFixed(0)
                    : maxWeightedSets.toFixed(1)}{' '}
                  {t('strength.sets')}
                </Text>
              </View>
            </View>
          </View>

          {selectedVolume && progression ? (
            <View style={[styles.progressCard, isDark && styles.progressCardDark]}>
              <View style={styles.progressHeader}>
                <View style={styles.progressHeaderText}>
                  <Text style={[styles.progressTitle, isDark && styles.progressTitleDark]}>
                    {t('strength.progression', {
                      muscle:
                        MUSCLE_DISPLAY_NAMES[selectedVolume.slug as MuscleSlug] ??
                        selectedVolume.slug,
                    })}
                  </Text>
                  <Text style={[styles.progressSubtitle, isDark && styles.progressSubtitleDark]}>
                    {t('strength.last4Weeks')}
                  </Text>
                </View>
                <View
                  style={[
                    styles.progressBadge,
                    progression.trend === 'up'
                      ? styles.progressBadgeUp
                      : progression.trend === 'down'
                        ? styles.progressBadgeDown
                        : styles.progressBadgeFlat,
                  ]}
                >
                  <Text style={styles.progressBadgeText}>
                    {progression.changePct == null
                      ? t('strength.newSignal')
                      : `${progression.changePct > 0 ? '+' : ''}${Math.round(
                          progression.changePct
                        )}%`}
                  </Text>
                </View>
              </View>

              <Text style={[styles.progressSummary, isDark && styles.progressSummaryDark]}>
                {!progression.points.some((p) => p.weightedSets > 0)
                  ? t('insights.strengthBalance.noRecentVolume')
                  : progression.changePct == null
                    ? t('insights.strengthBalance.volumeAppeared')
                    : progression.trend === 'up'
                      ? t('insights.strengthBalance.volumeUp', {
                          percent: Math.abs(progression.changePct).toFixed(0),
                        })
                      : progression.trend === 'down'
                        ? t('insights.strengthBalance.volumeDown', {
                            percent: Math.abs(progression.changePct).toFixed(0),
                          })
                        : t('insights.strengthBalance.volumeSteady')}
              </Text>

              {hasRecentProgression ? (
                <>
                  <View style={styles.progressBarsRow}>
                    {progression.points.map((point, index) => (
                      <View key={point.label} style={styles.progressBarColumn}>
                        <Text
                          style={[styles.progressBarValue, isDark && styles.progressBarValueDark]}
                        >
                          {formatSetCount(point.weightedSets)}
                        </Text>
                        <View
                          style={[styles.progressBarTrack, isDark && styles.progressBarTrackDark]}
                        >
                          <View
                            style={[
                              styles.progressBarFill,
                              index === progression.points.length - 1
                                ? styles.progressBarFillCurrent
                                : styles.progressBarFillPast,
                              {
                                height: Math.max(
                                  8,
                                  (point.weightedSets / maxProgressWeightedSets) * 82
                                ),
                              },
                            ]}
                          />
                        </View>
                        <Text
                          style={[styles.progressBarLabel, isDark && styles.progressBarLabelDark]}
                        >
                          {point.label}
                        </Text>
                      </View>
                    ))}
                  </View>

                  <View style={styles.progressMetaRow}>
                    <View style={[styles.progressMetaBox, isDark && styles.progressMetaBoxDark]}>
                      <Text
                        style={[styles.progressMetaValue, isDark && styles.progressMetaValueDark]}
                      >
                        {formatSetCount(progression.recentAverage)}
                      </Text>
                      <Text
                        style={[styles.progressMetaLabel, isDark && styles.progressMetaLabelDark]}
                      >
                        {t('strength.recentAvg')}
                      </Text>
                    </View>
                    <View style={[styles.progressMetaBox, isDark && styles.progressMetaBoxDark]}>
                      <Text
                        style={[styles.progressMetaValue, isDark && styles.progressMetaValueDark]}
                      >
                        {formatSetCount(progression.baselineAverage)}
                      </Text>
                      <Text
                        style={[styles.progressMetaLabel, isDark && styles.progressMetaLabelDark]}
                      >
                        {t('strength.earlierAvg')}
                      </Text>
                    </View>
                    <View style={[styles.progressMetaBox, isDark && styles.progressMetaBoxDark]}>
                      <Text
                        style={[styles.progressMetaValue, isDark && styles.progressMetaValueDark]}
                      >
                        {formatSetCount(progression.peakWeightedSets)}
                      </Text>
                      <Text
                        style={[styles.progressMetaLabel, isDark && styles.progressMetaLabelDark]}
                      >
                        {t('strength.peakWeek')}
                      </Text>
                    </View>
                  </View>
                </>
              ) : null}
            </View>
          ) : null}

          {/* Exercise detail list when muscle selected */}
          {selectedVolume && exerciseSummary && exerciseSummary.exercises.length > 0 && (
            <View style={[styles.exerciseCard, isDark && styles.exerciseCardDark]}>
              <Text style={[styles.exerciseCardTitle, isDark && styles.exerciseCardTitleDark]}>
                {t('strength.exercisesTargeting', {
                  muscle:
                    MUSCLE_DISPLAY_NAMES[selectedVolume.slug as MuscleSlug] ?? selectedVolume.slug,
                })}
              </Text>
              {exerciseSummary.exercises.map((exercise: ExerciseSummary, idx: number) => {
                const isExpanded = expandedExercise === exercise.exerciseCategory;
                return (
                  <View key={exercise.exerciseCategory}>
                    <TouchableOpacity
                      style={[
                        styles.exerciseCardItem,
                        idx > 0 && styles.exerciseCardItemBorder,
                        idx > 0 && isDark && styles.exerciseCardItemBorderDark,
                      ]}
                      onPress={() =>
                        setExpandedExercise(isExpanded ? null : exercise.exerciseCategory)
                      }
                      activeOpacity={0.7}
                    >
                      <View style={styles.exerciseCardDot} />
                      <View style={styles.exerciseCardContent}>
                        <View style={styles.exerciseCardNameRow}>
                          <Text
                            style={[styles.exerciseCardName, isDark && styles.exerciseCardNameDark]}
                            numberOfLines={1}
                          >
                            {exercise.exerciseName}
                          </Text>
                          <MaterialCommunityIcons
                            name={isExpanded ? 'chevron-up' : 'chevron-down'}
                            size={16}
                            color={isDark ? darkColors.textSecondary : colors.textSecondary}
                          />
                        </View>
                        <Text
                          style={[styles.exerciseCardMeta, isDark && styles.exerciseCardMetaDark]}
                        >
                          {t('strength.exerciseSets', {
                            sets: exercise.totalSets,
                          })}{' '}
                          ·{' '}
                          {t('strength.exerciseWorkoutCount', {
                            count: exercise.activityCount,
                          })}
                          {exercise.totalWeightKg > 0
                            ? ` · ${formatWeight(exercise.totalWeightKg, isMetric)}`
                            : ''}
                        </Text>
                      </View>
                    </TouchableOpacity>

                    {/* Expanded: per-activity breakdown */}
                    {isExpanded && exerciseActivities && exerciseActivities.length > 0 && (
                      <View style={[styles.activityList, isDark && styles.activityListDark]}>
                        {exerciseActivities.map((activity) => (
                          <TouchableOpacity
                            key={activity.activityId}
                            style={styles.activityRow}
                            onPress={() => router.push(`/activity/${activity.activityId}`)}
                            activeOpacity={0.7}
                          >
                            <View style={styles.activityRowLeft}>
                              <Text
                                style={[styles.activityName, isDark && styles.activityNameDark]}
                                numberOfLines={1}
                              >
                                {activity.activityName}
                              </Text>
                              <Text
                                style={[styles.activityDate, isDark && styles.activityDateDark]}
                              >
                                {new Date(activity.date * 1000).toLocaleDateString(undefined, {
                                  month: 'short',
                                  day: 'numeric',
                                })}
                              </Text>
                            </View>
                            <Text
                              style={[styles.activityStats, isDark && styles.activityStatsDark]}
                            >
                              {t('strength.exerciseSets', {
                                sets: activity.sets,
                              })}
                              {activity.totalWeightKg > 0
                                ? ` · ${formatWeight(activity.totalWeightKg, isMetric)}`
                                : ''}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                    {isExpanded && exerciseActivities && exerciseActivities.length === 0 && (
                      <View style={[styles.activityList, isDark && styles.activityListDark]}>
                        <ActivityIndicator size="small" color={colors.primary} />
                      </View>
                    )}
                  </View>
                );
              })}
              {selectedVolume.totalWeightKg > 0 && (
                <View style={[styles.exerciseCardTotal, isDark && styles.exerciseCardTotalDark]}>
                  <Text
                    style={[
                      styles.exerciseCardTotalLabel,
                      isDark && styles.exerciseCardTotalLabelDark,
                    ]}
                  >
                    {t('strength.totalVolume')}
                  </Text>
                  <Text
                    style={[
                      styles.exerciseCardTotalValue,
                      isDark && styles.exerciseCardTotalValueDark,
                    ]}
                  >
                    {formatWeight(selectedVolume.totalWeightKg, isMetric)}
                  </Text>
                </View>
              )}
            </View>
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

          {/* Balance card */}
          {visibleBalancePairs.length > 0 ? (
            <View style={[styles.balanceCard, isDark && styles.balanceCardDark]}>
              <View style={styles.balanceHeader}>
                <View>
                  <Text style={[styles.balanceTitle, isDark && styles.balanceTitleDark]}>
                    {t('insights.strengthBalance.volumeSplit')}
                  </Text>
                  <Text style={[styles.balanceSubtitle, isDark && styles.balanceSubtitleDark]}>
                    {t('strength.balanceObservedPairs', {
                      period: periodLabel,
                    })}
                  </Text>
                </View>
                {featuredBalancePair ? (
                  <View
                    style={[
                      styles.balanceHeroBadge,
                      featuredBalancePair.status === 'balanced'
                        ? styles.balanceHeroBadgeBalanced
                        : styles.balanceHeroBadgeAlert,
                    ]}
                  >
                    <Text style={styles.balanceHeroBadgeText}>
                      {formatBalanceRatio(featuredBalancePair)}
                    </Text>
                  </View>
                ) : null}
              </View>

              {featuredBalancePair ? (
                <Text style={[styles.balanceHeroText, isDark && styles.balanceHeroTextDark]}>
                  {featuredBalancePair.status === 'balanced'
                    ? t('strength.balancedPairsClose')
                    : t('strength.balanceDominant', {
                        dominant: featuredBalancePair.dominantLabel ?? 'One side',
                        other:
                          featuredBalancePair.dominantSlug === featuredBalancePair.leftSlug
                            ? featuredBalancePair.rightLabel
                            : featuredBalancePair.leftLabel,
                        pair: featuredBalancePair.label.toLowerCase(),
                      })}
                </Text>
              ) : null}

              {visibleBalancePairs.map((pair, index) => (
                <View
                  key={pair.id}
                  style={[
                    styles.balanceRow,
                    index > 0 && styles.balanceRowBorder,
                    index > 0 && isDark && styles.balanceRowBorderDark,
                  ]}
                >
                  <View style={styles.balanceRowHeader}>
                    <Text style={[styles.balanceRowTitle, isDark && styles.balanceRowTitleDark]}>
                      {pair.label}
                    </Text>
                    <View
                      style={[
                        styles.balanceStatusBadge,
                        pair.status === 'balanced'
                          ? styles.balanceStatusBalanced
                          : pair.status === 'watch'
                            ? styles.balanceStatusWatch
                            : styles.balanceStatusImbalanced,
                      ]}
                    >
                      <Text style={styles.balanceStatusText}>
                        {pair.status === 'balanced'
                          ? t('insights.strengthBalance.balanced')
                          : pair.status === 'watch'
                            ? t('insights.strengthBalance.watch')
                            : pair.status === 'imbalanced'
                              ? t('insights.strengthBalance.imbalanced')
                              : pair.status === 'one-sided'
                                ? t('insights.strengthBalance.oneSided')
                                : t('insights.strengthBalance.lowSignal')}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.balanceValueRow}>
                    <Text style={[styles.balanceValueText, isDark && styles.balanceValueTextDark]}>
                      {pair.leftLabel} {formatSetCount(pair.leftWeightedSets)}
                    </Text>
                    <Text style={[styles.balanceValueText, isDark && styles.balanceValueTextDark]}>
                      {pair.rightLabel} {formatSetCount(pair.rightWeightedSets)}
                    </Text>
                  </View>

                  <View style={[styles.balanceScale, isDark && styles.balanceScaleDark]}>
                    <View
                      style={[
                        styles.balanceScaleSide,
                        { flex: Math.max(pair.leftWeightedSets, 0.2) },
                      ]}
                    />
                    <View style={styles.balanceScaleGap} />
                    <View
                      style={[
                        styles.balanceScaleSideSecondary,
                        { flex: Math.max(pair.rightWeightedSets, 0.2) },
                      ]}
                    />
                  </View>

                  <Text style={[styles.balanceRatioText, isDark && styles.balanceRatioTextDark]}>
                    {formatBalanceRatio(pair)}
                  </Text>
                </View>
              ))}

              <Text style={[styles.balanceFootnote, isDark && styles.balanceFootnoteDark]}>
                {t('strength.balanceFootnote')}
              </Text>
            </View>
          ) : null}

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
  balanceCard: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  balanceCardDark: {
    backgroundColor: darkColors.surface,
  },
  balanceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  balanceTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  balanceTitleDark: {
    color: darkColors.textPrimary,
  },
  balanceSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  balanceSubtitleDark: {
    color: darkColors.textSecondary,
  },
  balanceHeroBadge: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  balanceHeroBadgeBalanced: {
    backgroundColor: '#22C55E18',
  },
  balanceHeroBadgeAlert: {
    backgroundColor: '#F9731618',
  },
  balanceHeroBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  balanceHeroText: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  balanceHeroTextDark: {
    color: darkColors.textSecondary,
  },
  balanceRow: {
    paddingVertical: spacing.sm,
  },
  balanceRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  balanceRowBorderDark: {
    borderTopColor: darkColors.border,
  },
  balanceRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  balanceRowTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  balanceRowTitleDark: {
    color: darkColors.textPrimary,
  },
  balanceStatusBadge: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  balanceStatusBalanced: {
    backgroundColor: '#22C55E18',
  },
  balanceStatusWatch: {
    backgroundColor: '#F59E0B18',
  },
  balanceStatusImbalanced: {
    backgroundColor: '#EF444418',
  },
  balanceStatusText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  balanceValueRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
    gap: spacing.sm,
  },
  balanceValueText: {
    flex: 1,
    fontSize: 12,
    color: colors.textSecondary,
  },
  balanceValueTextDark: {
    color: darkColors.textSecondary,
  },
  balanceScale: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 10,
    borderRadius: 5,
    overflow: 'hidden',
    backgroundColor: opacity.overlay.light,
    marginTop: spacing.xs,
  },
  balanceScaleDark: {
    backgroundColor: opacity.overlayDark.medium,
  },
  balanceScaleSide: {
    height: '100%',
    backgroundColor: brand.orange,
  },
  balanceScaleSideSecondary: {
    height: '100%',
    backgroundColor: '#FB8C4E',
  },
  balanceScaleGap: {
    width: 2,
    height: '100%',
    backgroundColor: colors.surface,
  },
  balanceRatioText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: 6,
  },
  balanceRatioTextDark: {
    color: darkColors.textPrimary,
  },
  balanceFootnote: {
    fontSize: 11,
    lineHeight: 16,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  balanceFootnoteDark: {
    color: darkColors.textSecondary,
  },
  bodyCard: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.sm,
  },
  bodyCardDark: {
    backgroundColor: darkColors.surface,
  },
  bodyHeader: {
    alignItems: 'center',
    marginBottom: spacing.xs,
    gap: 2,
  },
  bodyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  bodyTitleDark: {
    color: darkColors.textPrimary,
  },
  bodySubtitle: {
    fontSize: 11,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  bodySubtitleDark: {
    color: darkColors.textSecondary,
  },
  bodyHint: {
    fontSize: 11,
    color: colors.textDisabled,
    textAlign: 'center',
    marginBottom: spacing.xs,
    fontStyle: 'italic',
  },
  bodyHintDark: {
    color: darkColors.textMuted,
  },
  subtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginBottom: spacing.xs,
  },
  subtitleDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  subtitleText: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  subtitleTextDark: {
    color: darkColors.textSecondary,
  },
  scaleBarContainer: {
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
  scaleLabel: {
    fontSize: 10,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 4,
  },
  scaleLabelDark: {
    color: darkColors.textSecondary,
  },
  scaleBar: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  scaleGradient: {
    flex: 1,
    borderRadius: 4,
  },
  scaleLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  scaleValue: {
    fontSize: 10,
    color: colors.textSecondary,
  },
  scaleValueDark: {
    color: darkColors.textSecondary,
  },
  progressCard: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  progressCardDark: {
    backgroundColor: darkColors.surface,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  progressHeaderText: {
    flex: 1,
  },
  progressTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  progressTitleDark: {
    color: darkColors.textPrimary,
  },
  progressSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  progressSubtitleDark: {
    color: darkColors.textSecondary,
  },
  progressBadge: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  progressBadgeUp: {
    backgroundColor: '#22C55E18',
  },
  progressBadgeDown: {
    backgroundColor: '#F59E0B18',
  },
  progressBadgeFlat: {
    backgroundColor: '#64748B18',
  },
  progressBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  progressSummary: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  progressSummaryDark: {
    color: darkColors.textSecondary,
  },
  progressBarsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  progressBarColumn: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  progressBarValue: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  progressBarValueDark: {
    color: darkColors.textSecondary,
  },
  progressBarTrack: {
    width: '100%',
    height: 82,
    borderRadius: 12,
    backgroundColor: opacity.overlay.light,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  progressBarTrackDark: {
    backgroundColor: opacity.overlayDark.medium,
  },
  progressBarFill: {
    width: '100%',
    borderRadius: 12,
  },
  progressBarFillCurrent: {
    backgroundColor: brand.orange,
  },
  progressBarFillPast: {
    backgroundColor: '#FB8C4E',
  },
  progressBarLabel: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  progressBarLabelDark: {
    color: darkColors.textSecondary,
  },
  progressMetaRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  progressMetaBox: {
    flex: 1,
    backgroundColor: opacity.overlay.subtle,
    borderRadius: 10,
    padding: spacing.sm,
    alignItems: 'center',
  },
  progressMetaBoxDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  progressMetaValue: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  progressMetaValueDark: {
    color: darkColors.textPrimary,
  },
  progressMetaLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  progressMetaLabelDark: {
    color: darkColors.textSecondary,
  },
  exerciseCard: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  exerciseCardDark: {
    backgroundColor: darkColors.surface,
  },
  exerciseCardTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  exerciseCardTitleDark: {
    color: darkColors.textSecondary,
  },
  exerciseCardItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 8,
  },
  exerciseCardItemBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  exerciseCardItemBorderDark: {
    borderTopColor: darkColors.border,
  },
  exerciseCardDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: brand.orange,
  },
  exerciseCardContent: {
    flex: 1,
  },
  exerciseCardNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  exerciseCardName: {
    flex: 1,
    fontSize: 15,
    color: colors.textPrimary,
  },
  exerciseCardNameDark: {
    color: darkColors.textPrimary,
  },
  exerciseCardMeta: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  exerciseCardMetaDark: {
    color: darkColors.textSecondary,
  },
  activityList: {
    marginLeft: 14,
    paddingLeft: spacing.sm,
    borderLeftWidth: 1,
    borderLeftColor: colors.divider,
    marginBottom: spacing.xs,
  },
  activityListDark: {
    borderLeftColor: darkColors.border,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    paddingHorizontal: spacing.xs,
  },
  activityRowLeft: {
    flex: 1,
    marginRight: spacing.sm,
  },
  activityName: {
    fontSize: 13,
    color: colors.textPrimary,
  },
  activityNameDark: {
    color: darkColors.textPrimary,
  },
  activityDate: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 1,
  },
  activityDateDark: {
    color: darkColors.textSecondary,
  },
  activityStats: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  activityStatsDark: {
    color: darkColors.textSecondary,
  },
  exerciseCardTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.sm,
    marginTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  exerciseCardTotalDark: {
    borderTopColor: darkColors.border,
  },
  exerciseCardTotalLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  exerciseCardTotalLabelDark: {
    color: darkColors.textSecondary,
  },
  exerciseCardTotalValue: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  exerciseCardTotalValueDark: {
    color: darkColors.textPrimary,
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
