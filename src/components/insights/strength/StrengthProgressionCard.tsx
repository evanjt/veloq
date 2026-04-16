import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks';
import { MUSCLE_DISPLAY_NAMES, type MuscleSlug } from '@/lib/strength/exerciseMuscleMap';
import { colors, darkColors, spacing, opacity, layout, brand } from '@/theme';
import type { MuscleVolume, StrengthProgression } from '@/types';

function formatSetCount(sets: number): string {
  return sets % 1 === 0 ? sets.toFixed(0) : sets.toFixed(1);
}

interface StrengthProgressionCardProps {
  selectedVolume: MuscleVolume;
  progression: StrengthProgression;
  maxProgressWeightedSets: number;
}

export const StrengthProgressionCard = React.memo(function StrengthProgressionCard({
  selectedVolume,
  progression,
  maxProgressWeightedSets,
}: StrengthProgressionCardProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();

  return (
    <View style={[styles.progressCard, isDark && styles.progressCardDark]}>
      <View style={styles.progressHeader}>
        <View style={styles.progressHeaderText}>
          <Text style={[styles.progressTitle, isDark && styles.progressTitleDark]}>
            {t('strength.progression', {
              muscle:
                MUSCLE_DISPLAY_NAMES[selectedVolume.slug as MuscleSlug] ?? selectedVolume.slug,
            })}
          </Text>
          <Text style={[styles.progressSubtitle, isDark && styles.progressSubtitleDark]}>
            {t('strength.last4Weeks')}
          </Text>
        </View>
      </View>

      <View style={styles.progressBarsRow}>
        {progression.points.map((point, index) => (
          <View key={point.label} style={styles.progressBarColumn}>
            <Text style={[styles.progressBarValue, isDark && styles.progressBarValueDark]}>
              {formatSetCount(point.weightedSets)}
            </Text>
            <View style={[styles.progressBarTrack, isDark && styles.progressBarTrackDark]}>
              <View
                style={[
                  styles.progressBarFill,
                  index === progression.points.length - 1
                    ? styles.progressBarFillCurrent
                    : styles.progressBarFillPast,
                  {
                    height: Math.max(8, (point.weightedSets / maxProgressWeightedSets) * 82),
                  },
                ]}
              />
            </View>
            <Text style={[styles.progressBarLabel, isDark && styles.progressBarLabelDark]}>
              {point.label}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.progressMetaRow}>
        <View style={[styles.progressMetaBox, isDark && styles.progressMetaBoxDark]}>
          <Text style={[styles.progressMetaValue, isDark && styles.progressMetaValueDark]}>
            {formatSetCount(progression.recentAverage)}
          </Text>
          <Text style={[styles.progressMetaLabel, isDark && styles.progressMetaLabelDark]}>
            {t('strength.recentAvg')}
          </Text>
        </View>
        <View style={[styles.progressMetaBox, isDark && styles.progressMetaBoxDark]}>
          <Text style={[styles.progressMetaValue, isDark && styles.progressMetaValueDark]}>
            {formatSetCount(progression.baselineAverage)}
          </Text>
          <Text style={[styles.progressMetaLabel, isDark && styles.progressMetaLabelDark]}>
            {t('strength.earlierAvg')}
          </Text>
        </View>
        <View style={[styles.progressMetaBox, isDark && styles.progressMetaBoxDark]}>
          <Text style={[styles.progressMetaValue, isDark && styles.progressMetaValueDark]}>
            {formatSetCount(progression.peakWeightedSets)}
          </Text>
          <Text style={[styles.progressMetaLabel, isDark && styles.progressMetaLabelDark]}>
            {t('strength.peakWeek')}
          </Text>
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
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
});
