import React, { useMemo, useRef } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { useTheme } from '@/hooks';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { Canvas, Picture, Skia } from '@shopify/react-native-skia';
import { colors, darkColors, typography, spacing, layout } from '@/theme';
import type { Activity } from '@/types';

interface ActivityHeatmapProps {
  /** Activities to display */
  activities?: Activity[];
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

const WEEKS_TO_SHOW = 52;
const CELL_SIZE = 10;
const CELL_GAP = 2;
const DAY_LABELS_WIDTH = 20;
const DAY_LABELS_MARGIN = spacing.xs; // 4

export function ActivityHeatmap({ activities }: ActivityHeatmapProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const intensityColors = isDark ? INTENSITY_COLORS : INTENSITY_COLORS_LIGHT;
  const scrollRef = useRef<ScrollView>(null);

  const cellSize = CELL_SIZE;
  const cellGap = CELL_GAP;

  // Build activity intensity map (1 year of data).
  // Uses JS iteration over the full activity array from the API, not engine SQL,
  // because activity_metrics only covers the GPS sync window (~90 days)
  // while the heatmap needs 52 weeks.
  const activityMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!activities || activities.length === 0) return map;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - WEEKS_TO_SHOW * 7);

    for (const activity of activities) {
      const date = activity.start_date_local.split('T')[0];
      if (date < cutoff.toISOString().split('T')[0]) continue;

      const current = map.get(date) || 0;
      const duration = activity.moving_time || 0;
      let intensity = 1;
      if (duration > 3600) intensity = 2;
      if (duration > 5400) intensity = 3;
      if (duration > 7200) intensity = 4;

      map.set(date, Math.max(current, intensity));
    }

    return map;
  }, [activities]);

  // Generate grid data (flat intensity array for Picture — no object allocations)
  const { intensities, monthLabels, totalActivities } = useMemo(() => {
    const today = new Date();
    // Flat array: intensities[w * 7 + d]
    const intensities = new Uint8Array(WEEKS_TO_SHOW * 7);
    const monthPositions: { month: string; col: number; year?: number }[] = [];

    let lastMonth = -1;
    let lastYear = -1;

    for (let w = WEEKS_TO_SHOW - 1; w >= 0; w--) {
      for (let d = 0; d < 7; d++) {
        const date = new Date(today);
        date.setDate(date.getDate() - (w * 7 + (6 - d)));
        const dateStr = date.toISOString().split('T')[0];
        const col = WEEKS_TO_SHOW - 1 - w;
        intensities[col * 7 + d] = activityMap.get(dateStr) || 0;

        if (d === 0) {
          const month = date.getMonth();
          const year = date.getFullYear();
          if (month !== lastMonth) {
            const showYear = month === 0 || lastYear === -1 || year !== lastYear;
            monthPositions.push({
              month: MONTHS[month],
              col,
              year: showYear ? year : undefined,
            });
            lastMonth = month;
            lastYear = year;
          }
        }
      }
    }

    let total = 0;
    activityMap.forEach((v) => {
      if (v > 0) total++;
    });

    return { intensities, monthLabels: monthPositions, totalActivities: total };
  }, [activityMap]);

  const gridWidth = WEEKS_TO_SHOW * (cellSize + cellGap);
  const gridHeight = 7 * (cellSize + cellGap);

  // Pre-render entire heatmap grid as a single Skia Picture (zero React elements)
  const heatmapPicture = useMemo(() => {
    const recorder = Skia.PictureRecorder();
    const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, gridWidth, gridHeight));
    const paint = Skia.Paint();

    for (let w = 0; w < WEEKS_TO_SHOW; w++) {
      for (let d = 0; d < 7; d++) {
        paint.setColor(Skia.Color(intensityColors[intensities[w * 7 + d]]));
        canvas.drawRRect(
          Skia.RRectXY(
            Skia.XYWHRect(w * (cellSize + cellGap), d * (cellSize + cellGap), cellSize, cellSize),
            1,
            1
          ),
          paint
        );
      }
    }

    return recorder.finishRecordingAsPicture();
  }, [intensities, cellSize, cellGap, gridWidth, gridHeight, intensityColors]);

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

      {/* Horizontally scrollable heatmap grid */}
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
      >
        <View>
          {/* Month labels */}
          <View
            style={[
              styles.monthLabels,
              { width: gridWidth, marginLeft: DAY_LABELS_WIDTH + DAY_LABELS_MARGIN },
            ]}
          >
            {monthLabels.map((m, idx) =>
              m.year !== undefined ? (
                <View
                  key={idx}
                  style={[styles.monthLabelContainer, { left: m.col * (cellSize + cellGap) }]}
                >
                  <Text style={[styles.yearLabel, isDark && styles.textLight]}>{m.year}</Text>
                  <Text style={[styles.monthLabel, isDark && styles.textDark]}>{m.month}</Text>
                </View>
              ) : (
                <Text
                  key={idx}
                  style={[
                    styles.monthLabel,
                    styles.monthLabelAbsolute,
                    isDark && styles.textDark,
                    { left: m.col * (cellSize + cellGap) },
                  ]}
                >
                  {m.month}
                </Text>
              )
            )}
          </View>

          {/* Grid with day labels */}
          <View style={styles.gridContainer}>
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

            <Canvas style={{ width: gridWidth, height: gridHeight }}>
              <Picture picture={heatmapPicture} />
            </Canvas>
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
  monthLabels: {
    height: spacing.lg + spacing.xs,
    position: 'relative',
    marginBottom: spacing.xs,
  },
  monthLabelContainer: {
    position: 'absolute',
    bottom: 0,
  },
  yearLabel: {
    fontSize: typography.pillLabel.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 1,
  },
  monthLabel: {
    fontSize: typography.pillLabel.fontSize,
    color: colors.textSecondary,
  },
  monthLabelAbsolute: {
    position: 'absolute',
    bottom: 0,
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
