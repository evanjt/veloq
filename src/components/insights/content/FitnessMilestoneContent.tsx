import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/hooks';
import { colors, darkColors, spacing, opacity } from '@/theme';
import type { Insight } from '@/types';

interface FitnessMilestoneContentProps {
  insight: Insight;
}

export const FitnessMilestoneContent = React.memo(function FitnessMilestoneContent({
  insight,
}: FitnessMilestoneContentProps) {
  const { isDark } = useTheme();
  const dataPoints = insight.supportingData?.dataPoints;
  if (!dataPoints || dataPoints.length < 2) return null;

  const currentPoint = dataPoints[0];
  const previousPoint = dataPoints[1];
  const changePoint = dataPoints[2];

  const changeStr = changePoint ? String(changePoint.value) : '';
  const changeUnit = changePoint?.unit ?? '';
  const isPositive = changePoint?.context === 'good';
  const isPowerMilestone = currentPoint.unit === 'W';
  const isSwimMilestone = currentPoint.unit === '/100m';
  const contextSummary = isPowerMilestone
    ? `FTP shifted from ${String(previousPoint.value)}W to ${String(currentPoint.value)}W. Derived from recent power data.`
    : isSwimMilestone
      ? `Threshold swim pace shifted from ${String(previousPoint.value)} to ${String(currentPoint.value)} per 100m. Derived from recent swim data.`
      : `Running threshold pace shifted from ${String(previousPoint.value)} to ${String(currentPoint.value)} per km. Derived from recent run data.`;
  const contextHeading = isPowerMilestone
    ? 'FTP change context'
    : isSwimMilestone
      ? 'Swim pace change context'
      : 'Running pace change context';

  const lineColor = isDark ? darkColors.border : colors.border;
  const dotColor = isPositive ? '#22C55E' : '#F59E0B';

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
              { backgroundColor: isPositive ? '#22C55E18' : '#F59E0B18' },
            ]}
          >
            <MaterialCommunityIcons
              name={isPositive ? 'arrow-up' : 'arrow-down'}
              size={16}
              color={isPositive ? '#22C55E' : '#F59E0B'}
            />
            <Text style={[styles.changeText, { color: isPositive ? '#22C55E' : '#F59E0B' }]}>
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
                isPositive && styles.timelineValueGood,
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
    borderRadius: 10,
    padding: spacing.sm,
    alignItems: 'center',
  },
  statCardDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  currentValue: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  currentValueDark: {
    color: darkColors.textPrimary,
  },
  unit: {
    fontSize: 18,
    fontWeight: '400',
    color: colors.textSecondary,
  },
  unitDark: {
    color: darkColors.textSecondary,
  },
  changeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginTop: spacing.xs,
    gap: 4,
  },
  changeText: {
    fontSize: 14,
    fontWeight: '700',
  },
  timelineCard: {
    backgroundColor: opacity.overlay.subtle,
    borderRadius: 10,
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
    paddingTop: 4,
  },
  timelineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  timelineDotCurrent: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  timelineLine: {
    width: 2,
    flex: 1,
    minHeight: 20,
    marginVertical: 2,
  },
  timelineContent: {
    flex: 1,
    paddingLeft: spacing.sm,
    paddingBottom: spacing.sm,
  },
  timelineLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  timelineLabelDark: {
    color: darkColors.textSecondary,
  },
  timelineValue: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  timelineValueDark: {
    color: darkColors.textPrimary,
  },
  timelineValueGood: {
    color: '#22C55E',
  },
  contextCard: {
    backgroundColor: opacity.overlay.subtle,
    borderRadius: 10,
    padding: spacing.sm,
    gap: 4,
  },
  contextCardDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  contextHeading: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  contextHeadingDark: {
    color: darkColors.textPrimary,
  },
  contextBody: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  contextBodyDark: {
    color: darkColors.textSecondary,
  },
});
