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
  useExercisesForMuscle,
  useActivitiesForExercise,
} from '@/hooks/activities/useStrengthVolume';
import { useAthlete } from '@/hooks';
import { MUSCLE_DISPLAY_NAMES, type MuscleSlug } from '@/lib/strength/exerciseMuscleMap';
import { TAB_BAR_SAFE_PADDING } from '@/components/ui';
import { colors, darkColors, spacing, typography, opacity, layout } from '@/theme';
import type { StrengthPeriod, MuscleVolume, ExerciseSummary } from '@/types';

// 5-step color ramp from light to saturated for continuous heat map
const BODY_COLORS: readonly string[] = [
  '#FDDCC4', // 1 - very light
  '#FCA67A', // 2 - light orange
  '#FB8C4E', // 3 - medium orange
  '#FC6A1A', // 4 - dark orange
  '#FC4C02', // 5 - full primary
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

  // Find the selected muscle's data
  const selectedVolume: MuscleVolume | null = useMemo(() => {
    if (!selectedMuscle || !summary) return null;
    return summary.muscleVolumes.find((v) => v.slug === selectedMuscle) ?? null;
  }, [selectedMuscle, summary]);

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
    week: 'week',
    '4weeks': '4 weeks',
    '3months': '3 months',
    '6months': '6 months',
  };
  const periodLabel = periodLabels[period];

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
            No strength workouts in the last {periodLabel}
          </Text>
          <Text style={[styles.emptyHint, isDark && styles.emptyTextDark]}>
            Complete a strength workout to see your muscle group breakdown here
          </Text>
        </View>
      ) : (
        <>
          {/* Summary stats */}
          <View style={[styles.statsCard, isDark && styles.statsCardDark]}>
            <View style={styles.stat}>
              <Text style={[styles.statValue, isDark && styles.statValueDark]}>
                {summary.activityCount}
              </Text>
              <Text style={[styles.statLabel, isDark && styles.statLabelDark]}>
                {summary.activityCount === 1 ? 'workout' : 'workouts'}
              </Text>
            </View>
            <View style={styles.stat}>
              <Text style={[styles.statValue, isDark && styles.statValueDark]}>
                {summary.totalSets}
              </Text>
              <Text style={[styles.statLabel, isDark && styles.statLabelDark]}>sets</Text>
            </View>
            <View style={styles.stat}>
              <Text style={[styles.statValue, isDark && styles.statValueDark]}>
                {summary.muscleVolumes.length}
              </Text>
              <Text style={[styles.statLabel, isDark && styles.statLabelDark]}>muscle groups</Text>
            </View>
          </View>

          {/* Body diagrams */}
          <View style={[styles.bodyCard, isDark && styles.bodyCardDark]}>
            {/* Stable header: always shows title + a single-line subtitle */}
            <Text style={[styles.bodyTitle, isDark && styles.bodyTitleDark]}>
              Muscle Group Volume
            </Text>
            {selectedVolume ? (
              <TouchableOpacity
                style={styles.subtitleRow}
                onPress={() => setSelectedMuscle(null)}
                activeOpacity={0.7}
              >
                <View
                  style={[
                    styles.subtitleDot,
                    { backgroundColor: selectedVolume.primarySets > 0 ? '#FC4C02' : '#FCA67A' },
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
                  sets
                  {selectedVolume.totalReps > 0 ? ` · ${selectedVolume.totalReps} reps` : ''}
                </Text>
                <MaterialCommunityIcons
                  name="close"
                  size={14}
                  color={isDark ? darkColors.textMuted : colors.textDisabled}
                />
              </TouchableOpacity>
            ) : (
              <Text style={[styles.bodyHint, isDark && styles.bodyHintDark]}>
                Tap a muscle group for details
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
                Relative volume
              </Text>
              <View style={styles.scaleBar}>
                <LinearGradient
                  colors={[BODY_FILL_LIGHT, '#FDDCC4', '#FCA67A', '#FB8C4E', '#FC6A1A', '#FC4C02']}
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
                  sets
                </Text>
              </View>
            </View>
          </View>

          {/* Exercise detail list when muscle selected */}
          {selectedVolume && exerciseSummary && exerciseSummary.exercises.length > 0 && (
            <View style={[styles.exerciseCard, isDark && styles.exerciseCardDark]}>
              <Text style={[styles.exerciseCardTitle, isDark && styles.exerciseCardTitleDark]}>
                Exercises targeting{' '}
                {MUSCLE_DISPLAY_NAMES[selectedVolume.slug as MuscleSlug] ?? selectedVolume.slug}
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
                          {exercise.totalSets} sets · {exercise.activityCount}{' '}
                          {exercise.activityCount === 1 ? 'workout' : 'workouts'}
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
                              {activity.sets} sets
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
                    Total volume
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

          {/* Info card */}
          <View style={[styles.infoCard, isDark && styles.infoCardDark]}>
            <View style={styles.infoRow}>
              <MaterialCommunityIcons
                name="scale-balance"
                size={14}
                color={isDark ? darkColors.textMuted : colors.textDisabled}
              />
              <Text style={[styles.infoText, isDark && styles.infoTextDark]}>
                Primary exercises count as 1 set, secondary as 0.5 sets toward each muscle group.
              </Text>
            </View>
          </View>
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
  statsCard: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
  },
  statsCardDark: {
    backgroundColor: darkColors.surface,
  },
  stat: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  statValueDark: {
    color: darkColors.textPrimary,
  },
  statLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  statLabelDark: {
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
  bodyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  bodyTitleDark: {
    color: darkColors.textPrimary,
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
    backgroundColor: '#FC4C02',
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
});
