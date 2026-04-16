import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ExtendedBodyPart } from 'react-native-body-highlighter';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { BodyPairWithLoupe } from '@/components/activity/BodyPairWithLoupe';
import { useTheme, useMetricSystem } from '@/hooks';
import { MUSCLE_DISPLAY_NAMES, type MuscleSlug } from '@/lib/strength/exerciseMuscleMap';
import { colors, darkColors, spacing, opacity, layout, brand } from '@/theme';
import type { MuscleVolume, StrengthProgression, ExerciseSummary } from '@/types';

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

function formatSetCount(sets: number): string {
  return sets % 1 === 0 ? sets.toFixed(0) : sets.toFixed(1);
}

function formatWeight(kg: number, isMetric: boolean): string {
  if (isMetric) return `${Math.round(kg)} kg`;
  return `${Math.round(kg * 2.20462)} lbs`;
}

interface StrengthBodyDiagramProps {
  bodyData: ExtendedBodyPart[];
  gender: 'male' | 'female';
  maxWeightedSets: number;
  selectedVolume: MuscleVolume | null;
  progression: StrengthProgression | null;
  hasRecentProgression: boolean;
  maxProgressWeightedSets: number;
  exerciseSummary: { exercises: ExerciseSummary[] } | null;
  showMuscleDetails: boolean;
  tappableSlugs: Set<string>;
  onMuscleTap: (slug: string) => void;
  onMuscleScrub: (slug: string) => void;
  onClearSelection: () => void;
  onToggleDetails: () => void;
}

export const StrengthBodyDiagram = React.memo(function StrengthBodyDiagram({
  bodyData,
  gender,
  maxWeightedSets,
  selectedVolume,
  progression,
  hasRecentProgression,
  maxProgressWeightedSets,
  exerciseSummary,
  showMuscleDetails,
  tappableSlugs,
  onMuscleTap,
  onMuscleScrub,
  onClearSelection,
  onToggleDetails,
}: StrengthBodyDiagramProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const isMetric = useMetricSystem();

  return (
    <View testID="strength-body-diagram" style={[styles.bodyCard, isDark && styles.bodyCardDark]}>
      <View style={styles.bodyHeader}>
        <Text style={[styles.bodyTitle, isDark && styles.bodyTitleDark]}>
          {t('strength.muscleGroupVolume')}
        </Text>
        <Text style={[styles.bodySubtitle, isDark && styles.bodySubtitleDark]}>
          {t('strength.relativeWeightedSets')}
        </Text>
      </View>
      {selectedVolume ? (
        <TouchableOpacity style={styles.subtitleRow} onPress={onClearSelection} activeOpacity={0.7}>
          <View
            style={[
              styles.subtitleDot,
              {
                backgroundColor: selectedVolume.primarySets > 0 ? brand.orange : brand.orangeLight,
              },
            ]}
          />
          <Text style={[styles.subtitleText, isDark && styles.subtitleTextDark]} numberOfLines={1}>
            {MUSCLE_DISPLAY_NAMES[selectedVolume.slug as MuscleSlug] ?? selectedVolume.slug}
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
        onMuscleTap={onMuscleTap}
        onMuscleScrub={onMuscleScrub}
        tappableSlugs={tappableSlugs}
        defaultFill={isDark ? BODY_FILL_DARK : BODY_FILL_LIGHT}
      />

      {/* Continuous scale bar */}
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
            {maxWeightedSets % 1 === 0 ? maxWeightedSets.toFixed(0) : maxWeightedSets.toFixed(1)}{' '}
            {t('strength.sets')}
          </Text>
        </View>
      </View>

      {/* Inline muscle summary */}
      {selectedVolume && (
        <View
          testID="strength-inline-muscle-panel"
          style={[styles.inlineMusclePanel, isDark && styles.inlineMusclePanelDark]}
        >
          <View style={styles.inlineMuscleHeader}>
            <Text
              style={[styles.inlineMuscleName, isDark && styles.inlineMuscleNameDark]}
              numberOfLines={1}
            >
              {MUSCLE_DISPLAY_NAMES[selectedVolume.slug as MuscleSlug] ?? selectedVolume.slug}
            </Text>
            {progression && (
              <View
                style={[
                  styles.inlineTrendBadge,
                  progression.trend === 'up'
                    ? styles.progressBadgeUp
                    : progression.trend === 'down'
                      ? styles.progressBadgeDown
                      : styles.progressBadgeFlat,
                ]}
              >
                <Text style={styles.inlineTrendText}>
                  {progression.changePct == null
                    ? t('strength.newSignal')
                    : `${progression.changePct > 0 ? '+' : ''}${Math.round(
                        progression.changePct
                      )}%`}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.inlineStatsRow}>
            <View style={styles.inlineStat}>
              <Text style={[styles.inlineStatValue, isDark && styles.inlineStatValueDark]}>
                {formatSetCount(selectedVolume.weightedSets)}
              </Text>
              <Text style={[styles.inlineStatLabel, isDark && styles.inlineStatLabelDark]}>
                {t('strength.sets')}
              </Text>
            </View>
            {selectedVolume.totalReps > 0 && (
              <View style={styles.inlineStat}>
                <Text style={[styles.inlineStatValue, isDark && styles.inlineStatValueDark]}>
                  {selectedVolume.totalReps}
                </Text>
                <Text style={[styles.inlineStatLabel, isDark && styles.inlineStatLabelDark]}>
                  {t('strength.reps')}
                </Text>
              </View>
            )}
            {selectedVolume.totalWeightKg > 0 && (
              <View style={styles.inlineStat}>
                <Text style={[styles.inlineStatValue, isDark && styles.inlineStatValueDark]}>
                  {formatWeight(selectedVolume.totalWeightKg, isMetric)}
                </Text>
                <Text style={[styles.inlineStatLabel, isDark && styles.inlineStatLabelDark]}>
                  {t('strength.totalVolume')}
                </Text>
              </View>
            )}
            {exerciseSummary && (
              <View style={styles.inlineStat}>
                <Text style={[styles.inlineStatValue, isDark && styles.inlineStatValueDark]}>
                  {exerciseSummary.exercises.length}
                </Text>
                <Text style={[styles.inlineStatLabel, isDark && styles.inlineStatLabelDark]}>
                  {exerciseSummary.exercises.length === 1
                    ? t('strength.exercise')
                    : t('strength.exercises')}
                </Text>
              </View>
            )}
          </View>

          {/* Compact 4-week sparkline bars */}
          {progression && hasRecentProgression && (
            <View style={styles.inlineSparkRow}>
              {progression.points.map((point, index) => (
                <View key={point.label} style={styles.inlineSparkCol}>
                  <View style={[styles.inlineSparkTrack, isDark && styles.inlineSparkTrackDark]}>
                    <View
                      style={[
                        styles.inlineSparkFill,
                        index === progression.points.length - 1
                          ? styles.progressBarFillCurrent
                          : styles.progressBarFillPast,
                        {
                          height: Math.max(4, (point.weightedSets / maxProgressWeightedSets) * 32),
                        },
                      ]}
                    />
                  </View>
                  <Text style={[styles.inlineSparkLabel, isDark && styles.inlineSparkLabelDark]}>
                    {point.label}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {(exerciseSummary?.exercises.length ?? 0) > 0 && (
            <TouchableOpacity
              style={styles.inlineDetailsToggle}
              onPress={onToggleDetails}
              activeOpacity={0.7}
            >
              <Text style={styles.inlineDetailsToggleText}>
                {showMuscleDetails ? t('strength.hideDetails') : t('strength.showDetails')}
              </Text>
              <MaterialCommunityIcons
                name={showMuscleDetails ? 'chevron-up' : 'chevron-down'}
                size={14}
                color={colors.primary}
              />
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
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
  // Inline muscle summary panel (inside body card)
  inlineMusclePanel: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  inlineMusclePanelDark: {
    borderTopColor: darkColors.border,
  },
  inlineMuscleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.xs,
  },
  inlineMuscleName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
    flex: 1,
  },
  inlineMuscleNameDark: {
    color: darkColors.textPrimary,
  },
  inlineTrendBadge: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  inlineTrendText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textPrimary,
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
  inlineStatsRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
    gap: spacing.md,
  },
  inlineStat: {
    alignItems: 'center',
  },
  inlineStatValue: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  inlineStatValueDark: {
    color: darkColors.textPrimary,
  },
  inlineStatLabel: {
    fontSize: 10,
    color: colors.textSecondary,
    marginTop: 1,
  },
  inlineStatLabelDark: {
    color: darkColors.textSecondary,
  },
  inlineSparkRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-end',
    gap: 6,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  inlineSparkCol: {
    alignItems: 'center',
    gap: 2,
  },
  inlineSparkTrack: {
    width: 18,
    height: 36,
    borderRadius: 4,
    backgroundColor: opacity.overlay.light,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  inlineSparkTrackDark: {
    backgroundColor: opacity.overlayDark.medium,
  },
  inlineSparkFill: {
    width: '100%',
    borderRadius: 4,
  },
  progressBarFillCurrent: {
    backgroundColor: brand.orange,
  },
  progressBarFillPast: {
    backgroundColor: '#FB8C4E',
  },
  inlineSparkLabel: {
    fontSize: 9,
    color: colors.textSecondary,
  },
  inlineSparkLabelDark: {
    color: darkColors.textSecondary,
  },
  inlineDetailsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: spacing.sm,
    paddingVertical: spacing.xs,
  },
  inlineDetailsToggleText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
  },
});
