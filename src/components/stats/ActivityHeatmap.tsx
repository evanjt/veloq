import React, { useMemo, useRef, useEffect } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { useTheme } from '@/hooks';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { colors, darkColors } from '@/theme/colors';
import { typography } from '@/theme/typography';
import { spacing, layout } from '@/theme/spacing';
import type { Activity } from '@/types';

interface ActivityHeatmapProps {
  /** Activities to display */
  activities?: Activity[];
  /** Maximum number of weeks to show (default: 104 for 2 years) */
  maxWeeks?: number;
  /** Minimum number of weeks to show even with limited data (default: 12) */
  minWeeks?: number;
  /** Height of each cell */
  cellSize?: number;
}

// Color scale for activity intensity (based on TSS or duration)
const INTENSITY_COLORS = [
  '#161B22', // No activity (dark)
  '#0E4429', // Light
  '#006D32', // Medium-light
  '#26A641', // Medium
  '#39D353', // High
];

const INTENSITY_COLORS_LIGHT = [
  '#EBEDF0', // No activity
  '#9BE9A8', // Light
  '#40C463', // Medium-light
  '#30A14E', // Medium
  '#216E39', // High
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];

export function ActivityHeatmap({
  activities,
  maxWeeks = 104, // 2 years maximum
  minWeeks = 12, // At least 3 months
  cellSize = 12,
}: ActivityHeatmapProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const intensityColors = isDark ? INTENSITY_COLORS : INTENSITY_COLORS_LIGHT;
  const scrollViewRef = useRef<ScrollView>(null);

  // Calculate the actual number of weeks to display based on activity data
  const { activityMap, weeksToShow } = useMemo(() => {
    if (!activities || activities.length === 0) {
      return {
        activityMap: new Map<string, number>(),
        weeksToShow: minWeeks,
      };
    }

    const map = new Map<string, number>();
    let oldestDate: Date | null = null;

    activities.forEach((activity) => {
      const date = activity.start_date_local.split('T')[0];
      const activityDate = new Date(date);

      // Track oldest activity
      if (!oldestDate || activityDate < oldestDate) {
        oldestDate = activityDate;
      }

      const current = map.get(date) || 0;
      // Intensity based on moving time (rough categorization)
      const duration = activity.moving_time || 0;
      let intensity = 1;
      if (duration > 3600) intensity = 2; // > 1 hour
      if (duration > 5400) intensity = 3; // > 1.5 hours
      if (duration > 7200) intensity = 4; // > 2 hours

      map.set(date, Math.max(current, intensity));
    });

    // Calculate weeks from oldest activity to today
    const today = new Date();
    let calculatedWeeks = minWeeks;

    if (oldestDate !== null) {
      // Use calendar days for accurate week calculation
      const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const oldestDay = new Date(
        (oldestDate as Date).getFullYear(),
        (oldestDate as Date).getMonth(),
        (oldestDate as Date).getDate()
      );
      const daysSinceOldest = Math.round(
        (todayDay.getTime() - oldestDay.getTime()) / (1000 * 60 * 60 * 24)
      );
      const weeksSinceOldest = Math.ceil(daysSinceOldest / 7);
      // Add 1 week buffer to ensure the oldest activity is visible
      calculatedWeeks = Math.min(Math.max(weeksSinceOldest + 1, minWeeks), maxWeeks);
    }

    return { activityMap: map, weeksToShow: calculatedWeeks };
  }, [activities, minWeeks, maxWeeks]);

  // Generate grid data
  const { grid, monthLabels, totalActivities } = useMemo(() => {
    const today = new Date();
    const grid: { date: string; intensity: number }[][] = [];
    const monthPositions: { month: string; col: number }[] = [];

    let lastMonth = -1;

    for (let w = weeksToShow - 1; w >= 0; w--) {
      const week: { date: string; intensity: number }[] = [];

      for (let d = 0; d < 7; d++) {
        const date = new Date(today);
        date.setDate(date.getDate() - (w * 7 + (6 - d)));
        const dateStr = date.toISOString().split('T')[0];
        const intensity = activityMap.get(dateStr) || 0;

        week.push({ date: dateStr, intensity });

        // Track month labels
        const month = date.getMonth();
        if (month !== lastMonth && d === 0) {
          monthPositions.push({
            month: MONTHS[month],
            col: weeksToShow - 1 - w,
          });
          lastMonth = month;
        }
      }

      grid.push(week);
    }

    const total = Array.from(activityMap.values()).filter((v) => v > 0).length;

    return { grid, monthLabels: monthPositions, totalActivities: total };
  }, [activityMap, weeksToShow]);

  // Scroll to the right (current week) on mount
  useEffect(() => {
    // Small delay to ensure layout is complete
    const timer = setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: false });
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  // Show empty state if no activities
  if (!activities || activities.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={[styles.title, isDark && styles.textLight]}>
            {t('stats.activityCalendar')}
          </Text>
        </View>
        <View style={styles.emptyState}>
          <Text style={[styles.emptyText, isDark && styles.textDark]}>
            {t('stats.noActivityData')}
          </Text>
          <Text style={[styles.emptyHint, isDark && styles.textDark]}>
            {t('stats.completeActivitiesHeatmap')}
          </Text>
        </View>
      </View>
    );
  }

  const cellGap = 2;
  const gridWidth = weeksToShow * (cellSize + cellGap);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.title, isDark && styles.textLight]}>
          {t('stats.activityCalendar')}
        </Text>
        <Text style={[styles.subtitle, isDark && styles.textDark]}>
          {t('stats.activitiesCount', { count: totalActivities })}
        </Text>
      </View>

      {/* Scrollable heatmap container */}
      <ScrollView
        ref={scrollViewRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        <View>
          {/* Month labels */}
          <View style={[styles.monthLabels, { width: gridWidth, marginLeft: spacing.lg }]}>
            {monthLabels.map((m, idx) => (
              <Text
                key={idx}
                style={[
                  styles.monthLabel,
                  isDark && styles.textDark,
                  { left: m.col * (cellSize + cellGap) },
                ]}
              >
                {m.month}
              </Text>
            ))}
          </View>

          {/* Grid with day labels */}
          <View style={styles.gridContainer}>
            {/* Day labels */}
            <View style={styles.dayLabels}>
              {DAYS.map((day, idx) => (
                <Text
                  key={idx}
                  style={[
                    styles.dayLabel,
                    isDark && styles.textDark,
                    { height: cellSize + cellGap },
                  ]}
                >
                  {day}
                </Text>
              ))}
            </View>

            {/* Heatmap grid */}
            <View style={styles.grid}>
              {grid.map((week, wIdx) => (
                <View key={wIdx} style={styles.weekColumn}>
                  {week.map((day, dIdx) => (
                    <View
                      key={`${wIdx}-${dIdx}`}
                      style={[
                        styles.cell,
                        {
                          width: cellSize,
                          height: cellSize,
                          backgroundColor: intensityColors[day.intensity],
                          marginBottom: cellGap,
                        },
                      ]}
                    />
                  ))}
                </View>
              ))}
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Legend */}
      <View style={styles.legend}>
        <Text style={[styles.legendLabel, isDark && styles.textDark]}>{t('stats.less')}</Text>
        {intensityColors.map((color, idx) => (
          <View
            key={idx}
            style={[
              styles.legendCell,
              { backgroundColor: color, width: cellSize, height: cellSize },
            ]}
          />
        ))}
        <Text style={[styles.legendLabel, isDark && styles.textDark]}>{t('stats.more')}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {},
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: typography.cardTitle.fontSize,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textDark: {
    color: darkColors.textSecondary,
  },
  scrollContent: {
    paddingRight: spacing.md,
  },
  monthLabels: {
    height: spacing.md,
    position: 'relative',
    marginBottom: spacing.xs,
  },
  monthLabel: {
    position: 'absolute',
    fontSize: typography.pillLabel.fontSize,
    color: colors.textSecondary,
  },
  gridContainer: {
    flexDirection: 'row',
  },
  dayLabels: {
    width: 20,
    marginRight: spacing.xs,
  },
  dayLabel: {
    fontSize: typography.pillLabel.fontSize,
    color: colors.textSecondary,
    textAlign: 'right',
    lineHeight: typography.caption.lineHeight,
  },
  grid: {
    flexDirection: 'row',
  },
  weekColumn: {
    marginRight: 2,
  },
  cell: {
    borderRadius: 2,
  },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  legendLabel: {
    fontSize: typography.pillLabel.fontSize,
    color: colors.textSecondary,
    marginHorizontal: spacing.xs,
  },
  legendCell: {
    borderRadius: 2,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  emptyText: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  emptyHint: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
