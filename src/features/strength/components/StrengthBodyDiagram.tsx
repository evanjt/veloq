import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ExtendedBodyPart } from 'react-native-body-highlighter';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { Card, pressable, pressRipple } from '@/shared/ui';
import {
  bodyDiagram,
  brand,
  colors,
  darkColors,
  iconSize,
  layout,
  spacing,
  strengthRamp,
  typography,
} from '@/theme';
import type { MuscleVolume } from '@/types';

import { BodyPairWithLoupe } from './BodyPairWithLoupe';
import { muscleName } from '../lib/muscleNames';
import { useMetricSystem } from '@/shared/app/useMetricSystem';
import { formatWeightRounded } from '@/shared/format/weight';

const BODY_COLORS: readonly string[] = strengthRamp;
const BODY_FILL_LIGHT = bodyDiagram.fillLight;
const BODY_FILL_DARK = bodyDiagram.fillDark;

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
  const isMetric = useMetricSystem();
  // The legend's zero names the colour an untrained muscle is drawn in.
  const untrainedFill = isDark ? BODY_FILL_DARK : BODY_FILL_LIGHT;
  const selectedName = selectedVolume ? muscleName(selectedVolume.slug, t) : '';
  const selectedSummary = selectedVolume
    ? `${t('strength.setsCount', { count: Math.round(selectedVolume.weightedSets * 10) / 10 })} · ${formatWeightRounded(selectedVolume.volumeKg, isMetric)}`
    : '';

  return (
    <View testID="strength-body-diagram" style={styles.frame}>
      <Card variant="flat" padding="none">
        <View style={styles.body}>
          <View style={styles.bodyHeader}>
            <Text style={[styles.bodyTitle, isDark && styles.bodyTitleDark]}>
              {t('strength.muscleGroupVolume')}
            </Text>
            <Text style={[styles.bodySubtitle, isDark && styles.bodySubtitleDark]}>
              {t('strength.relativeWeightedSets')}
            </Text>
          </View>
          {selectedVolume ? (
            <Pressable
              android_ripple={pressRipple}
              accessibilityRole="button"
              accessibilityLabel={`${t('strength.clearMuscle', { muscle: selectedName })}, ${selectedSummary}`}
              style={pressable(styles.subtitleRow)}
              onPress={onClearSelection}
            >
              <View
                style={[
                  styles.subtitleDot,
                  {
                    backgroundColor:
                      selectedVolume.primarySets > 0 ? brand.tealLight : brand.tealDark,
                  },
                ]}
              />
              <Text
                style={[styles.subtitleText, isDark && styles.subtitleTextDark]}
                numberOfLines={1}
              >
                {selectedName}
              </Text>
              <Text
                testID="strength-selected-summary"
                style={[styles.subtitleText, isDark && styles.subtitleTextDark]}
                numberOfLines={1}
              >
                {`· ${selectedSummary}`}
              </Text>
              <MaterialCommunityIcons
                name="close"
                size={iconSize.sm}
                color={isDark ? darkColors.textSecondary : colors.textSecondary}
              />
            </Pressable>
          ) : (
            <Text style={[styles.bodyHint, isDark && styles.bodyHintDark]}>
              {t('strength.tapMuscleGroup')}
            </Text>
          )}

          <BodyPairWithLoupe
            data={bodyData}
            selectedSlug={selectedVolume?.slug ?? null}
            gender={gender}
            maxScale={0.6}
            colors={BODY_COLORS}
            onMuscleTap={onMuscleTap}
            onMuscleScrub={onMuscleScrub}
            tappableSlugs={tappableSlugs}
            defaultFill={untrainedFill}
            accessibilityLabel={t('strength.muscleGroupVolume')}
            accessibilityValueText={
              selectedVolume ? `${selectedName}, ${selectedSummary}` : undefined
            }
          />

          {/* Continuous scale bar */}
          <View style={styles.scaleBarContainer}>
            <Text style={[styles.scaleLabel, isDark && styles.scaleLabelDark]}>
              {t('strength.relativeVolume')}
            </Text>
            <View style={styles.scaleBar}>
              <LinearGradient
                colors={[untrainedFill, ...strengthRamp]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.scaleGradient}
              />
            </View>
            <View style={styles.scaleLabels}>
              <Text style={[styles.scaleValue, isDark && styles.scaleValueDark]}>0</Text>
              <Text style={[styles.scaleValue, isDark && styles.scaleValueDark]}>
                {t('strength.setsCount', { count: Math.round(maxWeightedSets * 10) / 10 })}
              </Text>
            </View>
          </View>
        </View>
      </Card>
    </View>
  );
});

const styles = StyleSheet.create({
  frame: {
    marginBottom: spacing.sm,
  },
  body: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  bodyHeader: {
    alignItems: 'center',
    marginBottom: spacing.xs,
    gap: spacing.xxs,
  },
  bodyTitle: {
    fontSize: typography.body.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  bodyTitleDark: {
    color: darkColors.textPrimary,
  },
  bodySubtitle: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  bodySubtitleDark: {
    color: darkColors.textSecondary,
  },
  bodyHint: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xs,
    fontStyle: 'italic',
  },
  bodyHintDark: {
    color: darkColors.textSecondary,
  },
  subtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  subtitleDot: {
    width: 7,
    height: 7,
    borderRadius: layout.borderRadiusFull,
  },
  subtitleText: {
    fontSize: typography.label.fontSize,
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
    fontSize: typography.micro.fontSize,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  scaleLabelDark: {
    color: darkColors.textSecondary,
  },
  scaleBar: {
    height: 8,
    borderRadius: layout.borderRadiusFull,
    overflow: 'hidden',
  },
  scaleGradient: {
    flex: 1,
    borderRadius: layout.borderRadiusXs,
  },
  scaleLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xxs,
  },
  scaleValue: {
    fontSize: typography.micro.fontSize,
    color: colors.textSecondary,
  },
  scaleValueDark: {
    color: darkColors.textSecondary,
  },
});
