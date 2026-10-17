import React, {
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useEffect,
} from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useTheme } from '@/shared/app';
import { isReduceMotionOn } from '@/shared/ui/reduceMotion';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { Canvas, Picture, Skia } from '@shopify/react-native-skia';
import { RangeCoverage } from 'veloqrs';
import { colors, darkColors, typography, spacing, contributionRamp, layout, stroke } from '@/theme';
import { useTrainingScreenData } from '../hooks/useEngineStats';
import { useWindowCoverage } from '@/shared/native/useRangeCoverage';
import {
  formatDurationHuman,
  formatFullDate,
  formatMonth,
  getIntlLocale,
} from '@/shared/format/format';
import { readActivities } from '@/shared/native/storedActivities';
import { composeAccessibilityLabel } from '@/shared/ui/accessibilityLabel';
import { pressable, pressRipple } from '@/shared/ui/pressFeedback';
import { dayActivityRow, useOpenDayActivities } from '@/features/activity/light';
import {
  cellPosition,
  columnYear,
  positionsOf,
  HEATMAP_CELL_GAP,
  HEATMAP_CELL_SIZE,
  HEATMAP_PITCH,
  HEATMAP_WEEKS,
} from '../lib/heatmapGrid';
import { CardHeader } from '@/shared/ui/CardHeader';
import { EmptyState } from '@/shared/ui/EmptyState';

interface ActivityHeatmapProps {
  /**
   * False holds the grid's box empty, with no picture recorded and no canvas
   * mounted, so a screen can paint its first frame before the Skia work. The
   * box is the canvas's own size, so drawing it moves nothing. Default true.
   */
  drawn?: boolean;
}

/** How the Health screen pushes a scrubbed day into the heatmap. */
export interface ActivityHeatmapHandle {
  /**
   * The day the scrub is over (YYYY-MM-DD), or null when it ends. Held on the
   * screen this re-rendered the whole tab per day crossed, up to 365 of them in
   * one swipe, and the heatmap is the only thing that draws it.
   */
  setHighlight: (date: string | null) => void;
}

// Color scale for activity intensity (based on training load or duration)
const INTENSITY_COLORS = contributionRamp.dark;
const INTENSITY_COLORS_LIGHT = contributionRamp.light;

/**
 * The legend's bins, intensity 1 to 4, which the engine brackets on the day's
 * longest moving time: up to an hour, then 1.5 h, then 2 h, then beyond.
 */
const LEGEND_BINS = [
  'stats.longestUnderOneHour',
  'stats.longestOneToOneAndAHalfHours',
  'stats.longestOneAndAHalfToTwoHours',
  'stats.longestOverTwoHours',
] as const;

/** The weekday rows that carry a name, Monday 0, every other one so they fit. */
const NAMED_ROWS = new Set([0, 2, 4]);

const CELL_SIZE = HEATMAP_CELL_SIZE;
const GRID_WIDTH = HEATMAP_WEEKS * HEATMAP_PITCH;
const GRID_HEIGHT = 7 * HEATMAP_PITCH;
/** The fixed column left of the scroll view, wide enough for a four digit year. */
const GUTTER_WIDTH = spacing.lg;
const GUTTER_MARGIN = spacing.xs;

/** A weekday's short name in the app language, Monday 0. */
function weekdayName(row: number): string {
  // 2 January 2023 was a Monday.
  return new Date(2023, 0, 2 + row).toLocaleDateString(getIntlLocale(), { weekday: 'short' });
}

/** The first column the viewport shows, from the scroll offset. */
function columnAt(offset: number): number {
  return Math.floor(Math.max(0, offset) / HEATMAP_PITCH);
}

export const ActivityHeatmap = React.forwardRef<ActivityHeatmapHandle, ActivityHeatmapProps>(
  function ActivityHeatmap({ drawn = true }, ref) {
    const [highlightDate, setHighlight] = useState<string | null>(null);
    useImperativeHandle(ref, () => ({ setHighlight }), []);
    const { t } = useTranslation();
    const { isDark } = useTheme();
    const intensityColors = isDark ? INTENSITY_COLORS : INTENSITY_COLORS_LIGHT;
    const scrollRef = useRef<ScrollView>(null);

    // The one interval every part of the card describes, and the days the
    // training screen read takes for it. It moves with the local date, so a
    // calendar left open past midnight moves with it.
    const {
      windows: { heatmap: grid },
      data: { heatmap },
      isPending,
    } = useTrainingScreenData();
    const firstDay = grid.cells[0].date;
    const lastDay = grid.cells[grid.cells.length - 1].date;

    // The engine updates this cache from activity metrics writes and removals.
    // Migration rebuilds it from stored metrics on upgrade. A read that throws
    // leaves the grid empty rather than failing the tab.
    const days = useMemo(() => {
      const map = new Map<
        string,
        { intensity: number; maxDuration: number; activityCount: number }
      >();
      for (const day of heatmap) map.set(day.date, day);
      return map;
    }, [heatmap]);

    const coverage = useWindowCoverage(firstDay, lastDay);

    // Flat intensity array for the picture, `col * 7 + row`, and the count of
    // activities on the days drawn. A day whose activities have no moving time
    // has no intensity and still counts.
    const { intensities, totalActivities } = useMemo(() => {
      const intensities = new Uint8Array(HEATMAP_WEEKS * 7);
      let total = 0;
      for (const cell of grid.cells) {
        const day = days.get(cell.date);
        if (!day) continue;
        intensities[cell.col * 7 + cell.row] = day.intensity;
        total += day.activityCount;
      }
      return { intensities, totalActivities: total };
    }, [grid, days]);

    // Names follow the app language. `t` is rebound when the language
    // changes, which is what rebuilds them.
    const labels = useMemo(
      () => ({
        months: grid.monthLabels.map((m) => ({ ...m, name: formatMonth(m.date) })),
        weekdays: Array.from({ length: 7 }, (_, row) =>
          NAMED_ROWS.has(row) ? weekdayName(row) : ''
        ),
        range: t('stats.calendarRange', {
          start: formatFullDate(grid.first),
          end: formatFullDate(grid.last),
        }),
      }),
      [grid, t]
    );

    const dividerColor = isDark ? darkColors.divider : colors.divider;

    // Pre-render entire heatmap grid as a single Skia Picture (zero React elements)
    const heatmapPicture = useMemo(() => {
      if (!drawn) return null;
      const recorder = Skia.PictureRecorder();
      const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, GRID_WIDTH, GRID_HEIGHT));
      const paint = Skia.Paint();

      for (const cell of grid.cells) {
        const { x, y } = cellPosition(cell.col, cell.row);
        paint.setColor(Skia.Color(intensityColors[intensities[cell.col * 7 + cell.row]]));
        canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(x, y, CELL_SIZE, CELL_SIZE), 1, 1), paint);
      }

      // Where January begins: down the gap left of 1 January's column from its
      // row, along the gap above it, and down the gap right of that column to
      // it, so December sits on one side of the line and January on the other.
      const boundary = grid.januaryBoundary;
      if (boundary) {
        const line = Skia.Paint();
        line.setColor(Skia.Color(dividerColor));
        line.setStrokeWidth(1);
        const left = boundary.col * HEATMAP_PITCH - 1;
        const right = left + HEATMAP_PITCH;
        const top = boundary.row * HEATMAP_PITCH - 1;
        if (boundary.row === 0) {
          canvas.drawLine(left, 0, left, GRID_HEIGHT, line);
        } else {
          canvas.drawLine(left, top, left, GRID_HEIGHT, line);
          canvas.drawLine(left, top, right, top, line);
          canvas.drawLine(right, 0, right, top, line);
        }
      }

      return recorder.finishRecordingAsPicture();
    }, [drawn, grid, intensities, intensityColors, dividerColor]);

    // A day's activities are read only when it is pressed, from the stored
    // bodies for that one date.
    const openDay = useOpenDayActivities();
    const openDayOn = useCallback(
      (date: string) => {
        void openDay(readActivities(date, date).map(dayActivityRow));
      },
      [openDay]
    );

    // One control over each day with activities, so the drawn grid can be
    // pressed and a screen reader hears what each day holds. Days with none
    // are left out: there is nothing to open or announce. Built with the grid,
    // so a scrub's re-render reuses the same elements.
    const dayControls = useMemo(() => {
      if (!drawn) return null;
      return grid.cells.map((cell) => {
        const day = days.get(cell.date);
        if (!day || day.activityCount === 0) return null;
        const { x, y } = cellPosition(cell.col, cell.row);
        const label = composeAccessibilityLabel(
          formatFullDate(cell.date),
          t('stats.activitiesCount', { count: day.activityCount }),
          day.maxDuration > 0
            ? t('stats.dayLongest', { duration: formatDurationHuman(day.maxDuration) })
            : null
        );
        return (
          <Pressable
            key={cell.date}
            testID={`activity-heatmap-day-${cell.date}`}
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={() => openDayOn(cell.date)}
            android_ripple={pressRipple}
            style={pressable([
              styles.dayControl,
              { left: x - HEATMAP_CELL_GAP / 2, top: y - HEATMAP_CELL_GAP / 2 },
            ])}
          />
        );
      });
    }, [drawn, grid, days, t, openDayOn]);

    // Built once with the grid, off the same layout, so a scrub tick is one
    // lookup rather than a walk of the year.
    const positions = useMemo(() => positionsOf(grid), [grid]);

    const highlightPos = useMemo(
      () => (highlightDate ? (positions.get(highlightDate) ?? null) : null),
      [highlightDate, positions]
    );

    // The year of the leftmost column in view, pinned beside the grid. Before
    // the first scroll event the view sits at its right end, so the column is
    // worked out from the viewport's width. State holds the column, not the
    // offset, so a scroll re-renders only when the column changes.
    const [viewportWidth, setViewportWidth] = useState(0);
    const [scrolledColumn, setScrolledColumn] = useState<number | null>(null);
    const onViewportLayout = useCallback((event: LayoutChangeEvent) => {
      setViewportWidth(event.nativeEvent.layout.width);
    }, []);
    const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
      setScrolledColumn(columnAt(event.nativeEvent.contentOffset.x));
    }, []);
    const leftColumn = scrolledColumn ?? columnAt(GRID_WIDTH - viewportWidth);
    const pinnedYear = columnYear(grid, leftColumn);

    // Auto-scroll to highlighted cell
    useEffect(() => {
      if (highlightPos && scrollRef.current) {
        const scrollX = Math.max(0, highlightPos.x - 100);
        scrollRef.current.scrollTo({ x: scrollX, animated: !isReduceMotionOn() });
      }
    }, [highlightPos]);

    // Show empty state when the drawn range holds nothing. The cache is the
    // source, so an empty grid and no activities are the same thing, and the
    // census says whether that is the account or a range never downloaded.
    if (totalActivities === 0) {
      const notDownloaded = coverage === RangeCoverage.NotFetched;
      return (
        <View style={styles.container}>
          <CardHeader title={t('stats.activityCalendar')} />
          {/* Until the first answer there is nothing to say about the range. */}
          <View style={styles.emptyState}>
            {!isPending && (
              <EmptyState
                variant="inline"
                title={notDownloaded ? t('stats.rangeNotDownloaded') : t('stats.noActivityData')}
                description={notDownloaded ? undefined : t('stats.completeActivitiesHeatmap')}
              />
            )}
          </View>
        </View>
      );
    }

    return (
      <View style={styles.container}>
        {/* Header */}
        <CardHeader
          testID="activity-heatmap-header"
          title={t('stats.activityCalendar')}
          subtitle={labels.range}
          accessory={
            <Text
              testID="activity-heatmap-count"
              style={[styles.subtitle, isDark && styles.textDark]}
            >
              {t('stats.activitiesCount', { count: totalActivities })}
            </Text>
          }
        />

        <View style={styles.body}>
          {/* Fixed gutter: the year in view and the weekday names */}
          <View style={styles.gutter}>
            <View style={styles.monthLabels}>
              <Text
                testID="activity-heatmap-year"
                style={[styles.yearLabel, styles.monthLabelAbsolute, isDark && styles.textLight]}
              >
                {pinnedYear}
              </Text>
            </View>
            {labels.weekdays.map((day, idx) => (
              <Text
                key={idx}
                numberOfLines={1}
                style={[styles.dayLabel, isDark && styles.textDark, { height: HEATMAP_PITCH }]}
              >
                {day}
              </Text>
            ))}
          </View>

          {/* Horizontally scrollable heatmap grid */}
          <ScrollView
            ref={scrollRef}
            testID="activity-heatmap-scroll"
            horizontal
            showsHorizontalScrollIndicator={false}
            onLayout={onViewportLayout}
            onScroll={onScroll}
            scrollEventThrottle={16}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
          >
            <View>
              {/* Month labels, January carrying its year */}
              <View style={[styles.monthLabels, { width: GRID_WIDTH }]}>
                {labels.months.map((m) =>
                  m.year !== undefined ? (
                    <View
                      key={m.col}
                      style={[styles.monthLabelContainer, { left: m.col * HEATMAP_PITCH }]}
                    >
                      <Text style={[styles.yearLabel, isDark && styles.textLight]}>{m.year}</Text>
                      <Text style={[styles.monthLabel, isDark && styles.textDark]}>{m.name}</Text>
                    </View>
                  ) : (
                    <Text
                      key={m.col}
                      style={[
                        styles.monthLabel,
                        styles.monthLabelAbsolute,
                        isDark && styles.textDark,
                        { left: m.col * HEATMAP_PITCH },
                      ]}
                    >
                      {m.name}
                    </Text>
                  )
                )}
              </View>

              <View>
                {heatmapPicture ? (
                  <Canvas style={styles.grid}>
                    <Picture picture={heatmapPicture} />
                  </Canvas>
                ) : (
                  <View testID="activity-heatmap-placeholder" style={styles.grid} />
                )}
                {highlightPos ? (
                  <View
                    style={[
                      styles.highlightCell,
                      {
                        left: highlightPos.x - 2,
                        top: highlightPos.y - 2,
                        width: CELL_SIZE + 4,
                        height: CELL_SIZE + 4,
                      },
                    ]}
                  />
                ) : null}
                {dayControls}
              </View>
            </View>
          </ScrollView>
        </View>

        {coverage === RangeCoverage.NotFetched && (
          <Text
            testID="activity-heatmap-partial"
            style={[styles.partial, isDark && styles.textDark]}
          >
            {t('stats.rangePartlyDownloaded')}
          </Text>
        )}

        {/* Legend: the measure the colour stands for, and its bins */}
        <View style={styles.legend}>
          <Text style={[styles.legendTitle, isDark && styles.textDark]}>
            {t('stats.longestSession')}
          </Text>
          {LEGEND_BINS.map((key, idx) => (
            <View key={key} style={styles.legendBin}>
              <View
                style={[
                  styles.legendCell,
                  {
                    backgroundColor: intensityColors[idx + 1],
                    width: CELL_SIZE,
                    height: CELL_SIZE,
                  },
                ]}
              />
              <Text style={[styles.legendLabel, isDark && styles.textDark]}>{t(key)}</Text>
            </View>
          ))}
        </View>
      </View>
    );
  }
);

const styles = StyleSheet.create({
  container: {},
  subtitle: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
  partial: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  body: {
    flexDirection: 'row',
  },
  grid: {
    width: GRID_WIDTH,
    height: GRID_HEIGHT,
  },
  gutter: {
    width: GUTTER_WIDTH,
    marginRight: GUTTER_MARGIN,
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
  dayLabel: {
    fontSize: typography.pillLabel.fontSize,
    color: colors.textSecondary,
    textAlign: 'right',
    lineHeight: typography.caption.lineHeight,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: spacing.sm,
    columnGap: spacing.sm,
    rowGap: spacing.xs,
  },
  legendTitle: {
    fontSize: typography.pillLabel.fontSize,
    fontWeight: typography.pillLabel.fontWeight,
    color: colors.textSecondary,
  },
  legendBin: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  legendLabel: {
    fontSize: typography.pillLabel.fontSize,
    color: colors.textSecondary,
  },
  dayControl: {
    position: 'absolute',
    width: HEATMAP_PITCH,
    height: HEATMAP_PITCH,
  },
  legendCell: {
    borderRadius: layout.borderRadiusXs,
  },
  highlightCell: {
    position: 'absolute',
    borderRadius: layout.borderRadiusXs,
    borderWidth: stroke.two,
    borderColor: colors.primary,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
});
