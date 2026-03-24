import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTheme } from '@/hooks';
import { colors, darkColors, spacing, opacity } from '@/theme';
import type { Insight } from '@/types';

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

const MIN_DOT_SIZE = 8;
const MAX_DOT_SIZE = 24;
const EMPTY_DOT_SIZE = 8;

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

  const activeColor = '#FF7043';
  const emptyColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)';

  const maxWeekCount = Math.max(thisWeek, lastWeek, 1);

  const getDotSize = useMemo(() => {
    return (count: number, dayIndex: number) => {
      if (dayIndex >= count) return EMPTY_DOT_SIZE;
      const scale = count / maxWeekCount;
      return MIN_DOT_SIZE + (MAX_DOT_SIZE - MIN_DOT_SIZE) * scale;
    };
  }, [maxWeekCount]);

  const renderDotRow = (label: string, count: number) => (
    <View style={styles.dotRow}>
      <Text style={[styles.rowLabel, isDark && styles.rowLabelDark]}>{label}</Text>
      <View style={styles.dots}>
        {DAY_LABELS.map((dayLabel, i) => {
          const isActive = i < count;
          const size = getDotSize(count, i);
          return (
            <View key={i} style={styles.dotColumn}>
              <View style={styles.dotWrapper}>
                <View
                  style={[
                    styles.dot,
                    {
                      width: size,
                      height: size,
                      borderRadius: size / 2,
                      backgroundColor: isActive ? activeColor : emptyColor,
                      opacity: isActive ? 0.6 + 0.4 * (count / maxWeekCount) : 1,
                    },
                  ]}
                />
              </View>
              <Text style={[styles.dayLabel, isDark && styles.dayLabelDark]}>{dayLabel}</Text>
            </View>
          );
        })}
      </View>
      <Text style={[styles.countText, isDark && styles.countTextDark]}>{count}</Text>
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
  dotWrapper: {
    width: MAX_DOT_SIZE,
    height: MAX_DOT_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {},
  dayLabel: {
    fontSize: 9,
    color: colors.textMuted,
  },
  dayLabelDark: {
    color: darkColors.textMuted,
  },
  countText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
    minWidth: 20,
    textAlign: 'right',
  },
  countTextDark: {
    color: darkColors.textPrimary,
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
