import React, { useImperativeHandle, useMemo, useRef, useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { useTheme } from '@/shared/app';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { Canvas, Picture, Skia } from '@shopify/react-native-skia';
import { colors, darkColors, typography, spacing, contributionRamp, layout } from '@/theme';
import { getEngine } from '@/shared/native/engine';
import { useEngineSubscription } from '@/shared/native/useEngineSubscription';
import { formatLocalDate } from '@/shared/format/format';
import {
  cellPositions,
  daysBack,
  HEATMAP_CELL_GAP,
  HEATMAP_CELL_SIZE,
  HEATMAP_WEEKS,
} from '../lib/heatmapGrid';

/** Nothing: the grid reads the engine and owns its own highlight. */
type ActivityHeatmapProps = object;

/** How the Health screen pushes a scrubbed day into the heatmap. */
export interface ActivityHeatmapHandle {
  /**
   * The day the scrub is over (YYYY-MM-DD), or null when it ends. Held on the
   * screen this re-rendered the whole tab per day crossed, up to 365 of them in
   * one swipe, and the heatmap is the only thing that draws it.
   */
  setHighlight: (date: string | null) => void;
}

// Color scale for activity intensity (based on TSS or duration)
const INTENSITY_COLORS = contributionRamp.dark;
const INTENSITY_COLORS_LIGHT = contributionRamp.light;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];

const WEEKS_TO_SHOW = HEATMAP_WEEKS;
const CELL_SIZE = HEATMAP_CELL_SIZE;
const CELL_GAP = HEATMAP_CELL_GAP;
const DAY_LABELS_WIDTH = 20;
const DAY_LABELS_MARGIN = spacing.xs; // 4

export const ActivityHeatmap = React.forwardRef<ActivityHeatmapHandle, ActivityHeatmapProps>(
  function ActivityHeatmap(_props, ref) {
    const [highlightDate, setHighlight] = useState<string | null>(null);
    useImperativeHandle(ref, () => ({ setHighlight }), []);
    const { t } = useTranslation();
    const { isDark } = useTheme();
    const intensityColors = isDark ? INTENSITY_COLORS : INTENSITY_COLORS_LIGHT;
    const scrollRef = useRef<ScrollView>(null);

    const cellSize = CELL_SIZE;
    const cellGap = CELL_GAP;

    // The engine's own event is what says the cache changed.
    const activitiesTrigger = useEngineSubscription(['activities']);

    // A year of intensities, from the engine's own cache. It is derived from
    // `activity_metrics` on every metrics write and rebuilt from that table by
    // migration, and that table covers exactly what `activity_bodies` covers, so
    // there is no range left for a JS pass over parsed bodies to fill in.
    const activityMap = useMemo(() => {
      const map = new Map<string, number>();
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - WEEKS_TO_SHOW * 7);
      const startDate = formatLocalDate(cutoff);
      const endDate = formatLocalDate(new Date());

      const engine = getEngine();
      if (engine) {
        try {
          const days = engine.getActivityHeatmap(startDate, endDate);
          for (const day of days) {
            map.set(day.date, day.intensity);
          }
        } catch {
          // A read that throws leaves the grid empty rather than failing the tab.
        }
      }

      return map;
    }, [activitiesTrigger]); // eslint-disable-line react-hooks/exhaustive-deps

    // Generate grid data (flat intensity array for Picture - no object allocations)
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
          date.setDate(date.getDate() - daysBack(w, d));
          const dateStr = formatLocalDate(date);
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

    // Built once with the grid, off the same date logic, so a scrub tick is one
    // lookup rather than 364 `Date` constructions and format calls.
    const positions = useMemo(() => cellPositions(new Date()), []);

    const highlightPos = useMemo(
      () => (highlightDate ? (positions.get(highlightDate) ?? null) : null),
      [highlightDate, positions]
    );

    // Auto-scroll to highlighted cell
    useEffect(() => {
      if (highlightPos && scrollRef.current) {
        const scrollX = Math.max(0, highlightPos.x - 100);
        scrollRef.current.scrollTo({ x: scrollX, animated: true });
      }
    }, [highlightPos]);

    // Show empty state when the year holds nothing. The cache is the source, so
    // an empty grid and no activities are the same thing.
    if (totalActivities === 0) {
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
          <Text
            testID="activity-heatmap-count"
            style={[styles.subtitle, isDark && styles.textDark]}
          >
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

              <View>
                <Canvas style={{ width: gridWidth, height: gridHeight }}>
                  <Picture picture={heatmapPicture} />
                </Canvas>
                {highlightPos && (
                  <View
                    style={[
                      styles.highlightCell,
                      {
                        left: highlightPos.x - 2,
                        top: highlightPos.y - 2,
                        width: cellSize + 4,
                        height: cellSize + 4,
                      },
                    ]}
                  />
                )}
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
);

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
    marginBottom: spacing.xxs,
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
    borderRadius: spacing.xxs,
  },
  highlightCell: {
    position: 'absolute',
    borderRadius: layout.borderRadiusXs,
    borderWidth: 2,
    borderColor: colors.primary,
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
