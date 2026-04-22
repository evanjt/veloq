import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ExtendedBodyPart } from 'react-native-body-highlighter';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { BodyPairWithLoupe } from '@/components/activity/BodyPairWithLoupe';
import { useTheme } from '@/hooks';
import { MUSCLE_DISPLAY_NAMES, type MuscleSlug } from '@/lib/strength/exerciseMuscleMap';
import { colors, darkColors, spacing, layout, brand } from '@/theme';
import type { MuscleVolume } from '@/types';

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

interface StrengthBodyDiagramProps {
  bodyData: ExtendedBodyPart[];
  gender: 'male' | 'female';
  maxWeightedSets: number;
  selectedVolume: MuscleVolume | null;
  tappableSlugs: Set<string>;
  onMuscleTap: (slug: string) => void;
  onMuscleScrub: (slug: string) => void;
  onClearSelection: () => void;
}

export const StrengthBodyDiagram = React.memo(function StrengthBodyDiagram({
  bodyData,
  gender,
  maxWeightedSets,
  selectedVolume,
  tappableSlugs,
  onMuscleTap,
  onMuscleScrub,
  onClearSelection,
}: StrengthBodyDiagramProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();

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
});
