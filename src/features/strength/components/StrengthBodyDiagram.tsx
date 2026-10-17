import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ExtendedBodyPart } from 'react-native-body-highlighter';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { Card, pressable, pressRipple, Shimmer, SkeletonFrame } from '@/shared/ui';
import {
  bodyDiagram,
  strengthTone,
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
import { BODY_INTRINSIC_H } from '../lib/bodyScale';
import { muscleName } from '../lib/muscleNames';
import { useMetricSystem } from '@/shared/app/useMetricSystem';
import { formatWeightRounded } from '@/shared/format/weight';
import { FitText } from '@/shared/ui/FitText';

const BODY_COLORS: readonly string[] = strengthRamp;
const BODY_FILL_LIGHT = bodyDiagram.fillLight;
const BODY_FILL_DARK = bodyDiagram.fillDark;
/** The largest scale the figures are drawn at, which sets the card's height. */
const BODY_MAX_SCALE = 0.6;

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
                      selectedVolume.primarySets > 0
                        ? strengthTone.primary
                        : strengthTone.secondary,
                  },
                ]}
              />
              <Text style={[styles.subtitleText, isDark && styles.subtitleTextDark]}>
                {selectedName}
              </Text>
              <FitText
                testID="strength-selected-summary"
                style={[styles.subtitleText, isDark && styles.subtitleTextDark]}
              >
                {`· ${selectedSummary}`}
              </FitText>
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
            maxScale={BODY_MAX_SCALE}
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

/** The body diagram card while the period's first read is pending, laid out as the card it becomes. */
export function StrengthBodyDiagramSkeleton() {
  return (
    <SkeletonFrame testID="strength-body-skeleton" style={styles.frame}>
      <Card variant="flat" padding="none">
        <View style={styles.body}>
          <View style={styles.bodyHeader}>
            <Shimmer
              width="50%"
              height={typography.body.lineHeight}
              borderRadius={layout.borderRadiusXs}
            />
            <Shimmer
              width="35%"
              height={typography.label.lineHeight}
              borderRadius={layout.borderRadiusXs}
            />
          </View>
          <Shimmer
            width="100%"
            height={BODY_INTRINSIC_H * BODY_MAX_SCALE}
            borderRadius={layout.borderRadius}
            style={styles.figuresPlaceholder}
          />
          <View style={styles.scaleBarContainer}>
            <Shimmer height={styles.scaleBar.height} borderRadius={layout.borderRadiusFull} />
          </View>
        </View>
      </Card>
    </SkeletonFrame>
  );
}

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
  figuresPlaceholder: {
    marginTop: typography.label.lineHeight + spacing.xs,
  },
  bodyTitle: {
    ...typography.bodyBold,
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
    ...typography.micro,
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
    ...typography.micro,
    color: colors.textSecondary,
  },
  scaleValueDark: {
    color: darkColors.textSecondary,
  },
});
