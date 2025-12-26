import React, { useMemo } from 'react';
import { View, StyleSheet, useColorScheme, ScrollView } from 'react-native';
import { Text } from 'react-native-paper';
import { colors, darkColors } from '@/theme/colors';
import { typography } from '@/theme/typography';
import { spacing, layout } from '@/theme/spacing';
import type { Activity } from '@/types';

interface ActivityHeatmapProps {
  /** Activities to display */
  activities?: Activity[];
  /** Number of weeks to show (default: 52 for a year) */
  weeks?: number;
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
  weeks = 26, // 6 months by default
  cellSize = 12,
}: ActivityHeatmapProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const intensityColors = isDark ? INTENSITY_COLORS : INTENSITY_COLORS_LIGHT;

  // Show empty state if no activities
  if (!activities || activities.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={[styles.title, isDark && styles.textLight]}>Activity Calendar</Text>
        </View>
        <View style={styles.emptyState}>
          <Text style={[styles.emptyText, isDark && styles.textDark]}>
            No activity data available
          </Text>
          <Text style={[styles.emptyHint, isDark && styles.textDark]}>
            Complete activities to see your calendar heatmap
          </Text>
        </View>
      </View>
    );
  }

  // Process activities into a date -> intensity map
  const activityMap = useMemo(() => {
    const map = new Map<string, number>();

    activities.forEach(activity => {
      const date = activity.start_date_local.split('T')[0];
      const current = map.get(date) || 0;
      // Intensity based on moving time (rough categorization)
      const duration = activity.moving_time || 0;
      let intensity = 1;
      if (duration > 3600) intensity = 2; // > 1 hour
      if (duration > 5400) intensity = 3; // > 1.5 hours
      if (duration > 7200) intensity = 4; // > 2 hours

      map.set(date, Math.max(current, intensity));
    });

    return map;
  }, [activities, weeks]);

  // Generate grid data
  const { grid, monthLabels, totalActivities } = useMemo(() => {
    const today = new Date();
    const grid: { date: string; intensity: number }[][] = [];
    const monthPositions: { month: string; col: number }[] = [];

    let lastMonth = -1;

    for (let w = weeks - 1; w >= 0; w--) {
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
          monthPositions.push({ month: MONTHS[month], col: weeks - 1 - w });
          lastMonth = month;
        }
      }

      grid.push(week);
    }

    const total = Array.from(activityMap.values()).filter(v => v > 0).length;

    return { grid, monthLabels: monthPositions, totalActivities: total };
  }, [activityMap, weeks]);

  const cellGap = 2;
  const gridWidth = weeks * (cellSize + cellGap);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.title, isDark && styles.textLight]}>Activity Calendar</Text>
        <Text style={[styles.subtitle, isDark && styles.textDark]}>
          {totalActivities} activities
        </Text>
      </View>

      {/* Scrollable heatmap container */}
      <ScrollView
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
        <Text style={[styles.legendLabel, isDark && styles.textDark]}>Less</Text>
        {intensityColors.map((color, idx) => (
          <View
            key={idx}
            style={[styles.legendCell, { backgroundColor: color, width: cellSize, height: cellSize }]}
          />
        ))}
        <Text style={[styles.legendLabel, isDark && styles.textDark]}>More</Text>
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
