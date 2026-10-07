import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import {
  colors,
  darkColors,
  spacing,
  opacity,
  verdictColor,
  verdictFill,
  layout,
  typography,
} from '@/theme';
import type { Insight } from '@/types';

/** What each milestone compares, named as its card names it. */
const CONTEXT_COPY = {
  power: {
    heading: 'insights.milestoneSheet.powerHeading',
    summary: 'insights.milestoneSheet.powerSummary',
  },
  run: {
    heading: 'insights.milestoneSheet.runHeading',
    summary: 'insights.milestoneSheet.runSummary',
  },
  swim: {
    heading: 'insights.milestoneSheet.swimHeading',
    summary: 'insights.milestoneSheet.swimSummary',
  },
} as const;

interface FitnessMilestoneContentProps {
  insight: Insight;
}

export const FitnessMilestoneContent = React.memo(function FitnessMilestoneContent({
  insight,
}: FitnessMilestoneContentProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const dataPoints = insight.supportingData?.dataPoints;
  if (!dataPoints || dataPoints.length < 2) return null;

  const currentPoint = dataPoints[0];
  const previousPoint = dataPoints[1];
  const changePoint = dataPoints[2];

  const changeStr = changePoint ? String(changePoint.value) : '';
  const changeUnit = changePoint?.unit ?? '';
  const isPositive = changePoint?.context === 'good';
  // The unit says which estimate moved: watts are the daily eFTP, a pace per
  // 100 metres or yards is critical swim speed, a pace per kilometre or mile
  // critical speed.
  const unit = currentPoint.unit ?? '';
  const kind = unit === 'W' ? 'power' : unit.startsWith('/100') ? 'swim' : 'run';
  const summaryValues = {
    previous: String(previousPoint.value),
    current: String(currentPoint.value),
    unit,
  };
  const contextHeading = t(CONTEXT_COPY[kind].heading);
  const contextSummary = t(CONTEXT_COPY[kind].summary, summaryValues);

  const lineColor = isDark ? darkColors.border : colors.border;
  const dotColor = verdictColor(isPositive ? 'positive' : 'negative', isDark);

  return (
    <View style={styles.container}>
      {/* Large current value */}
      <View style={[styles.statCard, isDark && styles.statCardDark]}>
        <Text style={[styles.currentValue, isDark && styles.currentValueDark]}>
          {String(currentPoint.value)}
          {currentPoint.unit ? (
            <Text style={[styles.unit, isDark && styles.unitDark]}> {currentPoint.unit}</Text>
          ) : null}
        </Text>

        {/* Change badge */}
        {changeStr ? (
          <View
            style={[
              styles.changeBadge,
              { backgroundColor: verdictFill(isPositive ? 'positive' : 'negative', isDark) },
            ]}
          >
            <MaterialCommunityIcons
              name={isPositive ? 'arrow-up' : 'arrow-down'}
              size={16}
              color={verdictColor(isPositive ? 'positive' : 'negative', isDark)}
            />
            <Text
              style={[
                styles.changeText,
                { color: verdictColor(isPositive ? 'positive' : 'negative', isDark) },
              ]}
            >
              {changeStr} {changeUnit}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Timeline: Previous → Current */}
      <View style={[styles.timelineCard, isDark && styles.timelineCardDark]}>
        {/* Previous value */}
        <View style={styles.timelineEntry}>
          <View style={styles.timelineDotColumn}>
            <View style={[styles.timelineDot, { backgroundColor: lineColor }]} />
            <View style={[styles.timelineLine, { backgroundColor: lineColor }]} />
          </View>
          <View style={styles.timelineContent}>
            <Text style={[styles.timelineLabel, isDark && styles.timelineLabelDark]}>
              {previousPoint.label}
            </Text>
            <Text style={[styles.timelineValue, isDark && styles.timelineValueDark]}>
              {String(previousPoint.value)}
              {previousPoint.unit ? ` ${previousPoint.unit}` : ''}
            </Text>
          </View>
        </View>

        {/* Current value */}
        <View style={styles.timelineEntry}>
          <View style={styles.timelineDotColumn}>
            <View
              style={[styles.timelineDot, styles.timelineDotCurrent, { backgroundColor: dotColor }]}
            />
          </View>
          <View style={styles.timelineContent}>
            <Text style={[styles.timelineLabel, isDark && styles.timelineLabelDark]}>
              {currentPoint.label}
            </Text>
            <Text
              style={[
                styles.timelineValue,
                isDark && styles.timelineValueDark,
                isPositive && { color: verdictColor('positive', isDark) },
              ]}
            >
              {String(currentPoint.value)}
              {currentPoint.unit ? ` ${currentPoint.unit}` : ''}
            </Text>
          </View>
        </View>
      </View>

      <View style={[styles.contextCard, isDark && styles.contextCardDark]}>
        <Text style={[styles.contextHeading, isDark && styles.contextHeadingDark]}>
          {contextHeading}
        </Text>
        <Text style={[styles.contextBody, isDark && styles.contextBodyDark]}>{contextSummary}</Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  statCard: {
    backgroundColor: opacity.overlay.subtle,
    borderRadius: layout.borderRadiusMd,
    padding: spacing.sm,
    alignItems: 'center',
  },
  statCardDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  currentValue: {
    fontSize: typography.statsValueLarge.fontSize,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  currentValueDark: {
    color: darkColors.textPrimary,
  },
  unit: {
    fontSize: typography.cardTitle.fontSize,
    fontWeight: '400',
    color: colors.textSecondary,
  },
  unitDark: {
    color: darkColors.textSecondary,
  },
  changeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.smPlus,
    paddingVertical: spacing.xs,
    borderRadius: layout.borderRadiusMd,
    marginTop: spacing.xs,
    gap: spacing.xs,
  },
  changeText: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '700',
  },
  timelineCard: {
    backgroundColor: opacity.overlay.subtle,
    borderRadius: layout.borderRadiusMd,
    padding: spacing.md,
  },
  timelineCardDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  timelineEntry: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  timelineDotColumn: {
    width: 20,
    alignItems: 'center',
    paddingTop: spacing.xs,
  },
  timelineDot: {
    width: 8,
    height: 8,
    borderRadius: layout.borderRadiusFull,
  },
  timelineDotCurrent: {
    width: 10,
    height: 10,
    borderRadius: layout.borderRadiusFull,
  },
  timelineLine: {
    width: 2,
    flex: 1,
    minHeight: 20,
    marginVertical: spacing.xxs,
  },
  timelineContent: {
    flex: 1,
    paddingLeft: spacing.sm,
    paddingBottom: spacing.sm,
  },
  timelineLabel: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    marginBottom: spacing.xxs,
  },
  timelineLabelDark: {
    color: darkColors.textSecondary,
  },
  timelineValue: {
    fontSize: typography.cardTitle.fontSize,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  timelineValueDark: {
    color: darkColors.textPrimary,
  },
  contextCard: {
    backgroundColor: opacity.overlay.subtle,
    borderRadius: layout.borderRadiusMd,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  contextCardDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  contextHeading: {
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  contextHeadingDark: {
    color: darkColors.textPrimary,
  },
  contextBody: {
    fontSize: typography.bodyCompact.fontSize,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  contextBodyDark: {
    color: darkColors.textSecondary,
  },
});
