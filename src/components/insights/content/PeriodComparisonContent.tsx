import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/hooks';
import { colors, darkColors, spacing, opacity } from '@/theme';
import type { Insight } from '@/types';

interface PeriodComparisonContentProps {
  insight: Insight;
}

export const PeriodComparisonContent = React.memo(function PeriodComparisonContent({
  insight,
}: PeriodComparisonContentProps) {
  const { isDark } = useTheme();
  const comparison = insight.supportingData?.comparisonData;
  const dataPoints = insight.supportingData?.dataPoints;

  if (!comparison) return null;

  const currentVal = typeof comparison.current.value === 'number' ? comparison.current.value : 0;
  const previousVal = typeof comparison.previous.value === 'number' ? comparison.previous.value : 0;
  const maxVal = Math.max(currentVal, previousVal, 1);

  const changeStr = String(comparison.change.value);
  const isPositive = changeStr.startsWith('+');
  const changeColor = isPositive ? colors.success : colors.warning;
  const changeIcon = isPositive ? 'arrow-up' : 'arrow-down';

  return (
    <View style={styles.container}>
      {/* Visual bars */}
      <View style={[styles.barsCard, isDark && styles.barsCardDark]}>
        {/* Current period bar */}
        <View style={styles.barRow}>
          <Text style={[styles.barLabel, isDark && styles.barLabelDark]}>
            {comparison.current.label}
          </Text>
          <View style={styles.barTrack}>
            <View
              style={[
                styles.barFill,
                {
                  width: `${(currentVal / maxVal) * 100}%`,
                  backgroundColor: isPositive ? colors.success : colors.warning,
                },
              ]}
            />
          </View>
          <Text style={[styles.barValue, isDark && styles.barValueDark]}>
            {String(comparison.current.value)}
            {comparison.current.unit ? ` ${comparison.current.unit}` : ''}
          </Text>
        </View>

        {/* Previous period bar */}
        <View style={styles.barRow}>
          <Text style={[styles.barLabel, isDark && styles.barLabelDark]}>
            {comparison.previous.label}
          </Text>
          <View style={styles.barTrack}>
            <View
              style={[
                styles.barFill,
                {
                  width: `${(previousVal / maxVal) * 100}%`,
                  backgroundColor: isDark ? darkColors.textMuted : colors.textMuted,
                },
              ]}
            />
          </View>
          <Text style={[styles.barValue, isDark && styles.barValueDark]}>
            {String(comparison.previous.value)}
            {comparison.previous.unit ? ` ${comparison.previous.unit}` : ''}
          </Text>
        </View>

        {/* Change badge */}
        <View style={styles.changeRow}>
          <MaterialCommunityIcons name={changeIcon as never} size={16} color={changeColor} />
          <Text style={[styles.changeText, { color: changeColor }]}>{changeStr}</Text>
        </View>
      </View>

      {/* Activity counts */}
      {dataPoints && dataPoints.length > 0 ? (
        <View style={styles.countRow}>
          {dataPoints.map((dp, i) => (
            <View key={i} style={[styles.countBox, isDark && styles.countBoxDark]}>
              <Text style={[styles.countValue, isDark && styles.countValueDark]}>
                {String(dp.value)}
              </Text>
              <Text style={[styles.countLabel, isDark && styles.countLabelDark]}>{dp.label}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  barsCard: {
    backgroundColor: opacity.overlay.subtle,
    borderRadius: 10,
    padding: spacing.md,
    gap: spacing.sm,
  },
  barsCardDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  barLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    width: 70,
  },
  barLabelDark: {
    color: darkColors.textSecondary,
  },
  barTrack: {
    flex: 1,
    height: 12,
    borderRadius: 6,
    backgroundColor: 'rgba(0,0,0,0.06)',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 6,
  },
  barValue: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
    minWidth: 50,
    textAlign: 'right',
  },
  barValueDark: {
    color: darkColors.textPrimary,
  },
  changeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingTop: spacing.xs,
  },
  changeText: {
    fontSize: 15,
    fontWeight: '700',
  },
  countRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  countBox: {
    flex: 1,
    backgroundColor: opacity.overlay.subtle,
    borderRadius: 10,
    padding: spacing.sm,
    alignItems: 'center',
  },
  countBoxDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  countValue: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  countValueDark: {
    color: darkColors.textPrimary,
  },
  countLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
    textAlign: 'center',
  },
  countLabelDark: {
    color: darkColors.textSecondary,
  },
});
