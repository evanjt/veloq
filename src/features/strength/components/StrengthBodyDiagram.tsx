import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import type { ExtendedBodyPart } from 'react-native-body-highlighter';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { Card, Shimmer, SkeletonGroup, PressTarget } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import { ChartSurface, partsSummary, partsTable } from '@/shared/charts';
import {
  bodyDiagram,
  chartStyles,
  colors,
  darkColors,
  iconSize,
  layout,
  spacing,
  stroke,
  typography,
} from '@/theme';
import type { MuscleVolume } from '@/types';

import { BodyPairWithLoupe } from './BodyPairWithLoupe';
import { BODY_INTRINSIC_H } from '../lib/bodyScale';
import { volumeStepCeilings } from '../lib/volumeSteps';
import { muscleName } from '../lib/muscleNames';
import { useMetricSystem } from '@/shared/app/useMetricSystem';
import { formatWeightRounded } from '@/shared/format/weight';
import { FitText } from '@/shared/ui/FitText';

/** The largest scale the figures are drawn at, which sets the card's height. */
const BODY_MAX_SCALE = 0.6;

interface StrengthBodyDiagramProps {
  bodyData: ExtendedBodyPart[];
  /** The period's trained muscles, which the summary and the Show data table list. */
  volumes?: readonly MuscleVolume[];
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
  volumes = NO_VOLUMES,
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
  const roles = bodyDiagram[isDark ? 'dark' : 'light'];
  // The legend keys untrained first, then each step with the most sets it covers.
  const legend = useMemo(() => {
    const ceilings = volumeStepCeilings(maxWeightedSets);
    return [
      { fill: roles.untrained, label: '0' },
      ...roles.steps.map((fill, i) => ({ fill, label: String(ceilings[i] ?? 0) })),
    ];
  }, [roles, maxWeightedSets]);
  const selectedName = selectedVolume ? muscleName(selectedVolume.slug, t) : '';
  const selectedSummary = selectedVolume
    ? `${t('strength.setsCount', { count: Math.round(selectedVolume.weightedSets * 10) / 10 })} · ${formatWeightRounded(selectedVolume.volumeKg, isMetric)}`
    : '';

  // What a screen reader hears and the Show data sheet lists: each trained muscle's weighted
  // sets, most first.
  const reading = useMemo(() => {
    const title = t('strength.muscleGroupVolume');
    const parts = [...volumes]
      .sort((a, b) => b.weightedSets - a.weightedSets)
      .map((volume) => ({
        label: muscleName(volume.slug, t),
        value: t('strength.setsCount', { count: Math.round(volume.weightedSets * 10) / 10 }),
      }));
    return {
      summary: partsSummary(title, parts, t),
      table: partsTable(title, t('charts.column.muscle'), t('charts.column.sets'), parts),
    };
  }, [volumes, t]);

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
            <PressTarget
              accessibilityRole="button"
              accessibilityLabel={`${t('strength.clearMuscle', { muscle: selectedName })}, ${selectedSummary}`}
              style={styles.subtitleRow}
              onPress={onClearSelection}
            >
              <View
                style={[
                  styles.subtitleDot,
                  {
                    backgroundColor:
                      selectedVolume.primarySets > 0 ? roles.primary : roles.secondary,
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
              <Icon
                name="close"
                size={iconSize.sm}
                color={isDark ? darkColors.textSecondary : colors.textSecondary}
              />
            </PressTarget>
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
            colors={roles.steps}
            onMuscleTap={onMuscleTap}
            onMuscleScrub={onMuscleScrub}
            tappableSlugs={tappableSlugs}
            accessibilityLabel={t('strength.muscleGroupVolume')}
            accessibilityValueText={
              selectedVolume ? `${selectedName}, ${selectedSummary}` : undefined
            }
          />

          {/* Stepped legend. The figures are their own adjustable control, so the
              chart's reading sits on the scale that keys them rather than around them. */}
          <ChartSurface
            summary={reading.summary}
            table={reading.table}
            style={styles.scaleSurface}
            testID="strength-body-plot"
          >
            <View style={styles.scaleBarContainer}>
              <Text
                style={[
                  chartStyles.chartLabel,
                  isDark && chartStyles.chartLabelDark,
                  styles.scaleLabel,
                ]}
              >
                {t('strength.relativeVolume')}
              </Text>
              <View style={styles.legendRow}>
                {legend.map((step, i) => (
                  <View key={i} style={styles.legendStep}>
                    <View
                      testID={`strength-legend-step-${i}`}
                      style={[
                        styles.legendSwatch,
                        i === 0 && { borderColor: roles.untrainedStroke },
                        i === 0 && styles.legendSwatchUntrained,
                        { backgroundColor: step.fill },
                      ]}
                    />
                    <Text
                      testID={`strength-legend-label-${i}`}
                      style={[chartStyles.chartLabel, isDark && chartStyles.chartLabelDark]}
                    >
                      {step.label}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          </ChartSurface>
        </View>
      </Card>
    </View>
  );
});

const NO_VOLUMES: readonly MuscleVolume[] = [];

/** The body diagram card while the period's first read is pending, laid out as the card it becomes. */
export function StrengthBodyDiagramSkeleton() {
  return (
    <SkeletonGroup testID="strength-body-skeleton" style={styles.frame}>
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
    </SkeletonGroup>
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
  scaleSurface: {
    flex: 0,
  },
  scaleBarContainer: {
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
  scaleLabel: {
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  scaleBar: {
    height: 8,
    borderRadius: layout.borderRadiusFull,
    overflow: 'hidden',
  },
  legendRow: {
    flexDirection: 'row',
    gap: spacing.xxs,
  },
  legendStep: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xxs,
  },
  legendSwatch: {
    alignSelf: 'stretch',
    height: 8,
    borderRadius: layout.borderRadiusXs,
  },
  legendSwatchUntrained: {
    borderWidth: stroke.one,
  },
});
