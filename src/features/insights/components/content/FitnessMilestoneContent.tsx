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
import { formatEpochDayUtc } from '@/shared/format/format';
import type { Insight } from '@/types';
import { verdictIcon, verdictRung } from '@/shared/format/trend';

/** What each milestone compares, named as its card names it. */
const CONTEXT_COPY = {
  power: {
    heading: 'insights.milestoneSheet.powerHeading',
    summary: 'insights.milestoneSheet.powerSummary',
    undated: 'insights.milestoneSheet.powerSummaryUndated',
  },
  run: {
    heading: 'insights.milestoneSheet.runHeading',
    summary: 'insights.milestoneSheet.runSummary',
    undated: 'insights.milestoneSheet.runSummary',
  },
  swim: {
    heading: 'insights.milestoneSheet.swimHeading',
    summary: 'insights.milestoneSheet.swimSummary',
    undated: 'insights.milestoneSheet.swimSummary',
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
  const [currentPoint, previousPoint, changePoint] = dataPoints ?? [];
  if (!currentPoint || !previousPoint) return null;

  const changeStr = changePoint ? String(changePoint.value) : '';
  const changeUnit = changePoint?.unit ?? '';
  // The move the generator judged for this milestone, never the change row's
  // own context, so the badge draws the one verdict the insight carries.
  const trend = insight.supportingData?.trend;
  const rung = trend ? verdictRung(trend.verdict) : 'neutral';
  const glyph = trend ? verdictIcon(trend.verdict, trend.direction) : 'minus';
  const rungColor = verdictColor(rung, isDark);
  // The unit says which estimate moved: watts are the daily eFTP, a pace per
  // 100 metres or yards is critical swim speed, a pace per kilometre or mile
  // critical speed.
  const unit = currentPoint.unit ?? '';
  const kind = unit === 'W' ? 'power' : unit.startsWith('/100') ? 'swim' : 'run';
  // Each value carries the day it was read. The earlier one is the newest day at
  // or before the window's start, so it is named by its date, never by the window.
  const previousDate = previousPoint.date != null ? formatEpochDayUtc(previousPoint.date) : null;
  const currentDate = currentPoint.date != null ? formatEpochDayUtc(currentPoint.date) : null;
  const dated = previousDate != null && currentDate != null;
  const summaryValues = {
    previous: String(previousPoint.value),
    current: String(currentPoint.value),
    unit,
    previousDate,
    currentDate,
  };
  const contextHeading = t(CONTEXT_COPY[kind].heading);
  const contextSummary = t(
    dated ? CONTEXT_COPY[kind].summary : CONTEXT_COPY[kind].undated,
    summaryValues
  );

  const lineColor = isDark ? darkColors.border : colors.border;

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
          <View style={[styles.changeBadge, { backgroundColor: verdictFill(rung, isDark) }]}>
            <MaterialCommunityIcons name={glyph} size={16} color={rungColor} />
            <Text style={[styles.changeText, { color: rungColor }]}>
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
              {previousDate ? `${previousPoint.label} · ${previousDate}` : previousPoint.label}
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
              style={[
                styles.timelineDot,
                styles.timelineDotCurrent,
                { backgroundColor: rungColor },
              ]}
            />
          </View>
          <View style={styles.timelineContent}>
            <Text style={[styles.timelineLabel, isDark && styles.timelineLabelDark]}>
              {currentDate ? `${currentPoint.label} · ${currentDate}` : currentPoint.label}
            </Text>
            <Text
              style={[
                styles.timelineValue,
                isDark && styles.timelineValueDark,
                rung === 'positive' && { color: rungColor },
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
