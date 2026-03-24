import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTheme } from '@/hooks';
import { colors, darkColors, spacing, opacity } from '@/theme';
import type { Insight } from '@/types';

interface WeeklyLoadContentProps {
  insight: Insight;
}

export const WeeklyLoadContent = React.memo(function WeeklyLoadContent({
  insight,
}: WeeklyLoadContentProps) {
  const { isDark } = useTheme();
  const dataPoints = insight.supportingData?.dataPoints;
  if (!dataPoints || dataPoints.length < 2) return null;

  const thisWeekPoint = dataPoints[0];
  const avgPoint = dataPoints[1];
  const changePoint = dataPoints[2];

  const thisWeekVal = typeof thisWeekPoint.value === 'number' ? thisWeekPoint.value : 0;
  const avgVal = typeof avgPoint.value === 'number' ? avgPoint.value : 0;
  const maxVal = Math.max(thisWeekVal, avgVal, 1);

  const changeStr = changePoint ? String(changePoint.value) : '';
  const isAbove = thisWeekVal > avgVal;
  const barColor = isAbove ? '#FFA726' : '#42A5F5';

  return (
    <View style={styles.container}>
      {/* Load bars */}
      <View style={[styles.card, isDark && styles.cardDark]}>
        {/* This week */}
        <View style={styles.barRow}>
          <Text style={[styles.barLabel, isDark && styles.barLabelDark]}>This week</Text>
          <View style={styles.barTrack}>
            <View
              style={[
                styles.barFill,
                { width: `${(thisWeekVal / maxVal) * 100}%`, backgroundColor: barColor },
              ]}
            />
          </View>
          <Text style={[styles.barValue, isDark && styles.barValueDark]}>
            {thisWeekVal} {thisWeekPoint.unit ?? ''}
          </Text>
        </View>

        {/* 4-week average */}
        <View style={styles.barRow}>
          <Text style={[styles.barLabel, isDark && styles.barLabelDark]}>4-wk avg</Text>
          <View style={styles.barTrack}>
            <View
              style={[
                styles.barFill,
                {
                  width: `${(avgVal / maxVal) * 100}%`,
                  backgroundColor: isDark ? darkColors.textMuted : colors.textMuted,
                },
              ]}
            />
          </View>
          <Text style={[styles.barValue, isDark && styles.barValueDark]}>
            {avgVal} {avgPoint.unit ?? ''}
          </Text>
        </View>

        {/* Change badge */}
        {changeStr ? (
          <View style={[styles.changeBadge, { backgroundColor: `${barColor}18` }]}>
            <Text style={[styles.changeText, { color: barColor }]}>{changeStr}</Text>
          </View>
        ) : null}
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
    gap: spacing.sm,
  },
  cardDark: {
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
    width: 65,
  },
  barLabelDark: {
    color: darkColors.textSecondary,
  },
  barTrack: {
    flex: 1,
    height: 14,
    borderRadius: 7,
    backgroundColor: 'rgba(0,0,0,0.06)',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 7,
  },
  barValue: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
    minWidth: 60,
    textAlign: 'right',
  },
  barValueDark: {
    color: darkColors.textPrimary,
  },
  changeBadge: {
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginTop: spacing.xs,
  },
  changeText: {
    fontSize: 15,
    fontWeight: '700',
  },
});
