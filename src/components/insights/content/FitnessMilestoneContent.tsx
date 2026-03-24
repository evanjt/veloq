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

      {/* Before → After */}
      <View style={styles.transitionRow}>
        <View style={[styles.transitionBox, isDark && styles.transitionBoxDark]}>
          <Text style={[styles.transitionLabel, isDark && styles.transitionLabelDark]}>Before</Text>
          <Text style={[styles.transitionValue, isDark && styles.transitionValueDark]}>
            {String(previousPoint.value)}
            {previousPoint.unit ? ` ${previousPoint.unit}` : ''}
          </Text>
        </View>
        <MaterialCommunityIcons
          name="arrow-right"
          size={20}
          color={isDark ? darkColors.textMuted : colors.textMuted}
        />
        <View style={[styles.transitionBox, isDark && styles.transitionBoxDark]}>
          <Text style={[styles.transitionLabel, isDark && styles.transitionLabelDark]}>After</Text>
          <Text
            style={[
              styles.transitionValue,
              isDark && styles.transitionValueDark,
              isPositive && styles.transitionValueGood,
            ]}
          >
            {String(currentPoint.value)}
            {currentPoint.unit ? ` ${currentPoint.unit}` : ''}
          </Text>
        </View>
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
    padding: spacing.md,
    alignItems: 'center',
  },
  statCardDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  currentValue: {
    fontSize: 32,
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
    marginTop: spacing.sm,
    gap: 4,
  },
  changeText: {
    fontSize: 14,
    fontWeight: '700',
  },
  transitionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  transitionBox: {
    flex: 1,
    backgroundColor: opacity.overlay.subtle,
    borderRadius: 10,
    padding: spacing.sm,
    alignItems: 'center',
  },
  transitionBoxDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  transitionLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  transitionLabelDark: {
    color: darkColors.textSecondary,
  },
  transitionValue: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  transitionValueDark: {
    color: darkColors.textPrimary,
  },
  transitionValueGood: {
    color: '#22C55E',
  },
});
