import React, { useState, useCallback, useMemo } from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ExtendedBodyPart } from 'react-native-body-highlighter';
import { useTranslation } from 'react-i18next';
import { TappableBody } from '@/components/activity/TappableBody';
import { useTheme, useMetricSystem } from '@/hooks';
import { useStrengthVolume } from '@/hooks/activities/useStrengthVolume';
import { useAthlete } from '@/hooks';
import { MUSCLE_DISPLAY_NAMES, type MuscleSlug } from '@/lib/strength/exerciseMuscleMap';
import { TAB_BAR_SAFE_PADDING } from '@/components/ui';
import { colors, darkColors, spacing, typography, opacity, layout } from '@/theme';
import type { StrengthPeriod, MuscleVolume } from '@/types';

const PRIMARY_COLOR = '#FC4C02';
const SECONDARY_COLOR = '#FCA67A';
const PERIODS: { id: StrengthPeriod; label: string }[] = [
  { id: 'week', label: '7 Days' },
  { id: '4weeks', label: '4 Weeks' },
  { id: '3months', label: '3 Months' },
  { id: '6months', label: '6 Months' },
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
  const [period, setPeriod] = useState<StrengthPeriod>('4weeks');
  const [selectedMuscle, setSelectedMuscle] = useState<string | null>(null);

  const { data: summary, isLoading } = useStrengthVolume(period);

  const gender = athlete?.sex === 'F' ? 'female' : 'male';

  // Compute body diagram data with heat-map intensity
  const bodyData: ExtendedBodyPart[] = useMemo(() => {
    if (!summary || summary.muscleVolumes.length === 0) return [];
    const maxWeighted = Math.max(...summary.muscleVolumes.map((v) => v.weightedSets));
    if (maxWeighted === 0) return [];

    return summary.muscleVolumes.map((v) => {
      // Normalize to 1-2 intensity range for the body highlighter
      const normalized = v.weightedSets / maxWeighted;
      return {
        slug: v.slug as ExtendedBodyPart['slug'],
        intensity: normalized < 0.5 ? 1 : 2,
      };
    });
  }, [summary]);

  // Find the selected muscle's data
  const selectedVolume: MuscleVolume | null = useMemo(() => {
    if (!selectedMuscle || !summary) return null;
    return summary.muscleVolumes.find((v) => v.slug === selectedMuscle) ?? null;
  }, [selectedMuscle, summary]);

  const handleMuscleTap = useCallback((slug: string) => {
    setSelectedMuscle((prev) => (prev === slug ? null : slug));
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
            <Text style={[styles.bodyTitle, isDark && styles.bodyTitleDark]}>
              Muscle Group Volume
            </Text>
            <Text style={[styles.bodyHint, isDark && styles.bodyHintDark]}>
              Tap a muscle group for details
            </Text>

            <View style={styles.bodyRow}>
              <View style={styles.bodyView}>
                <TappableBody
                  data={bodyData}
                  gender={gender}
                  side="front"
                  scale={0.6}
                  colors={[SECONDARY_COLOR, PRIMARY_COLOR]}
                  onMuscleTap={handleMuscleTap}
                  onMuscleScrub={handleMuscleScrub}
                  tappableSlugs={tappableSlugs}
                  selectedSlug={selectedMuscle}
                />
              </View>
              <View style={styles.bodyView}>
                <TappableBody
                  data={bodyData}
                  gender={gender}
                  side="back"
                  scale={0.6}
                  colors={[SECONDARY_COLOR, PRIMARY_COLOR]}
                  onMuscleTap={handleMuscleTap}
                  onMuscleScrub={handleMuscleScrub}
                  tappableSlugs={tappableSlugs}
                  selectedSlug={selectedMuscle}
                />
              </View>
            </View>

            {/* Legend */}
            <View style={styles.legendRow}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: PRIMARY_COLOR }]} />
                <Text style={[styles.legendText, isDark && styles.legendTextDark]}>
                  High volume
                </Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: SECONDARY_COLOR }]} />
                <Text style={[styles.legendText, isDark && styles.legendTextDark]}>Low volume</Text>
              </View>
            </View>
          </View>

          {/* Selected muscle detail (inline expansion) */}
          {selectedVolume && (
            <View style={[styles.detailCard, isDark && styles.detailCardDark]}>
              <View style={styles.detailHeader}>
                <Text style={[styles.detailTitle, isDark && styles.detailTitleDark]}>
                  {MUSCLE_DISPLAY_NAMES[selectedVolume.slug as MuscleSlug] ?? selectedVolume.slug}
                </Text>
                <TouchableOpacity onPress={() => setSelectedMuscle(null)} hitSlop={12}>
                  <MaterialCommunityIcons
                    name="close"
                    size={18}
                    color={isDark ? darkColors.textSecondary : colors.textSecondary}
                  />
                </TouchableOpacity>
              </View>

              {/* Volume stats */}
              <View style={styles.detailStatsRow}>
                <View style={styles.detailStat}>
                  <Text style={[styles.detailStatValue, isDark && styles.detailStatValueDark]}>
                    {selectedVolume.weightedSets.toFixed(1)}
                  </Text>
                  <Text style={[styles.detailStatLabel, isDark && styles.detailStatLabelDark]}>
                    weighted sets
                  </Text>
                </View>
                <View style={styles.detailStat}>
                  <Text style={[styles.detailStatValue, isDark && styles.detailStatValueDark]}>
                    {selectedVolume.primarySets}
                  </Text>
                  <Text style={[styles.detailStatLabel, isDark && styles.detailStatLabelDark]}>
                    primary
                  </Text>
                </View>
                <View style={styles.detailStat}>
                  <Text style={[styles.detailStatValue, isDark && styles.detailStatValueDark]}>
                    {selectedVolume.secondarySets}
                  </Text>
                  <Text style={[styles.detailStatLabel, isDark && styles.detailStatLabelDark]}>
                    secondary
                  </Text>
                </View>
                {selectedVolume.totalReps > 0 && (
                  <View style={styles.detailStat}>
                    <Text style={[styles.detailStatValue, isDark && styles.detailStatValueDark]}>
                      {selectedVolume.totalReps}
                    </Text>
                    <Text style={[styles.detailStatLabel, isDark && styles.detailStatLabelDark]}>
                      reps
                    </Text>
                  </View>
                )}
              </View>

              {/* Volume context */}
              {period === 'week' && (
                <View style={[styles.contextRow, isDark && styles.contextRowDark]}>
                  <MaterialCommunityIcons
                    name="information-outline"
                    size={14}
                    color={isDark ? darkColors.textMuted : colors.textDisabled}
                  />
                  <Text style={[styles.contextText, isDark && styles.contextTextDark]}>
                    10–20 sets/week per major muscle group is recommended for hypertrophy
                    (Schoenfeld et al., 2017)
                  </Text>
                </View>
              )}

              {/* Contributing exercises */}
              {selectedVolume.exerciseNames.length > 0 && (
                <View style={styles.exerciseList}>
                  <Text style={[styles.exerciseListTitle, isDark && styles.exerciseListTitleDark]}>
                    Exercises
                  </Text>
                  {selectedVolume.exerciseNames.map((name, idx) => (
                    <View
                      key={name}
                      style={[
                        styles.exerciseItem,
                        idx > 0 && styles.exerciseItemBorder,
                        idx > 0 && isDark && styles.exerciseItemBorderDark,
                      ]}
                    >
                      <View style={styles.exerciseBullet} />
                      <Text style={[styles.exerciseName, isDark && styles.exerciseNameDark]}>
                        {name}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Total volume */}
              {selectedVolume.totalWeightKg > 0 && (
                <View style={[styles.totalRow, isDark && styles.totalRowDark]}>
                  <Text style={[styles.totalLabel, isDark && styles.totalLabelDark]}>
                    Total volume
                  </Text>
                  <Text style={[styles.totalValue, isDark && styles.totalValueDark]}>
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
                Primary exercises count as 1 set, secondary as 0.5 sets toward each muscle group's
                weekly volume. This reflects how compound movements contribute less stimulus to
                secondary muscles.
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
  bodyRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bodyView: {
    flex: 1,
    alignItems: 'center',
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
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  legendTextDark: {
    color: darkColors.textSecondary,
  },
  detailCard: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  detailCardDark: {
    backgroundColor: darkColors.surface,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  detailTitle: {
    ...typography.cardTitle,
    color: colors.textPrimary,
  },
  detailTitleDark: {
    color: darkColors.textPrimary,
  },
  detailStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: spacing.sm,
    borderRadius: 8,
    backgroundColor: colors.background,
    marginBottom: spacing.sm,
  },
  detailStat: {
    alignItems: 'center',
  },
  detailStatValue: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  detailStatValueDark: {
    color: darkColors.textPrimary,
  },
  detailStatLabel: {
    fontSize: 10,
    color: colors.textSecondary,
    marginTop: 2,
  },
  detailStatLabelDark: {
    color: darkColors.textSecondary,
  },
  contextRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
    borderRadius: 6,
    backgroundColor: colors.background,
    marginBottom: spacing.sm,
  },
  contextRowDark: {
    backgroundColor: darkColors.background,
  },
  contextText: {
    flex: 1,
    fontSize: 11,
    color: colors.textDisabled,
    lineHeight: 16,
  },
  contextTextDark: {
    color: darkColors.textMuted,
  },
  exerciseList: {
    marginBottom: spacing.sm,
  },
  exerciseListTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  exerciseListTitleDark: {
    color: darkColors.textSecondary,
  },
  exerciseItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 8,
  },
  exerciseItemBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  exerciseItemBorderDark: {
    borderTopColor: darkColors.border,
  },
  exerciseBullet: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: PRIMARY_COLOR,
  },
  exerciseName: {
    fontSize: 14,
    color: colors.textPrimary,
  },
  exerciseNameDark: {
    color: darkColors.textPrimary,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  totalRowDark: {
    borderTopColor: darkColors.border,
  },
  totalLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  totalLabelDark: {
    color: darkColors.textSecondary,
  },
  totalValue: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  totalValueDark: {
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
