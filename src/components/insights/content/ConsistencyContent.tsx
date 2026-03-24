import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTheme } from '@/hooks';
import { colors, darkColors, spacing, opacity } from '@/theme';
import type { Insight } from '@/types';

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

interface ConsistencyContentProps {
  insight: Insight;
}

export const ConsistencyContent = React.memo(function ConsistencyContent({
  insight,
}: ConsistencyContentProps) {
  const { isDark } = useTheme();
  const dataPoints = insight.supportingData?.dataPoints;

  const thisWeekCount = dataPoints?.find((dp) => dp.label.toLowerCase().includes('this'))?.value;
  const lastWeekCount = dataPoints?.find((dp) => dp.label.toLowerCase().includes('last'))?.value;

  const thisWeek = typeof thisWeekCount === 'number' ? thisWeekCount : 0;
  const lastWeek = typeof lastWeekCount === 'number' ? lastWeekCount : 0;

  const dotColor = '#FF7043';
  const emptyColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)';

  // Generate dot patterns: fill from Monday for thisWeek/lastWeek count
  // Since we don't have per-day data, show filled count from left
  const renderDotRow = (label: string, count: number) => (
    <View style={styles.dotRow}>
      <Text style={[styles.rowLabel, isDark && styles.rowLabelDark]}>{label}</Text>
      <View style={styles.dots}>
        {DAY_LABELS.map((dayLabel, i) => (
          <View key={i} style={styles.dotColumn}>
            <View style={[styles.dot, { backgroundColor: i < count ? dotColor : emptyColor }]} />
            <Text style={[styles.dayLabel, isDark && styles.dayLabelDark]}>{dayLabel}</Text>
          </View>
        ))}
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={[styles.card, isDark && styles.cardDark]}>
        {renderDotRow('This week', thisWeek)}
        {renderDotRow('Last week', lastWeek)}
      </View>

      {/* Total stat */}
      <View style={styles.totalRow}>
        <View style={[styles.totalBox, isDark && styles.totalBoxDark]}>
          <Text style={[styles.totalValue, isDark && styles.totalValueDark]}>
            {thisWeek + lastWeek}
          </Text>
          <Text style={[styles.totalLabel, isDark && styles.totalLabelDark]}>
            activities in 2 weeks
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
  card: {
    backgroundColor: opacity.overlay.subtle,
    borderRadius: 10,
    padding: spacing.md,
    gap: spacing.md,
  },
  cardDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  dotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rowLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    width: 65,
  },
  rowLabelDark: {
    color: darkColors.textSecondary,
  },
  dots: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  dotColumn: {
    alignItems: 'center',
    gap: 4,
  },
  dot: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  dayLabel: {
    fontSize: 9,
    color: colors.textMuted,
  },
  dayLabelDark: {
    color: darkColors.textMuted,
  },
  totalRow: {
    flexDirection: 'row',
  },
  totalBox: {
    flex: 1,
    backgroundColor: opacity.overlay.subtle,
    borderRadius: 10,
    padding: spacing.sm,
    alignItems: 'center',
  },
  totalBoxDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  totalValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FF7043',
  },
  totalValueDark: {
    color: '#FF7043',
  },
  totalLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  totalLabelDark: {
    color: darkColors.textSecondary,
  },
});
