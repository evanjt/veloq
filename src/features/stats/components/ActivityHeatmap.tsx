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
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useTheme } from '@/shared/app';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { Canvas, Picture, Skia } from '@shopify/react-native-skia';
import { RangeCoverage } from 'veloqrs';
import { colors, darkColors, typography, spacing, contributionRamp, layout } from '@/theme';
import { useTrainingScreenData } from '../hooks/useEngineStats';
import { useWindowCoverage } from '@/shared/native/useRangeCoverage';
import { formatFullDate, formatMonth, getIntlLocale } from '@/shared/format/format';
import {
  cellPosition,
  columnYear,
  positionsOf,
  HEATMAP_CELL_SIZE,
  HEATMAP_PITCH,
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

/** The weekday rows that carry a name, Sunday 0, every other one so they fit. */
const NAMED_ROWS = new Set([1, 3, 5]);

const CELL_SIZE = HEATMAP_CELL_SIZE;
const GRID_WIDTH = HEATMAP_WEEKS * HEATMAP_PITCH;
const GRID_HEIGHT = 7 * HEATMAP_PITCH;
/** The fixed column left of the scroll view, wide enough for a four digit year. */
const GUTTER_WIDTH = spacing.lg;
const GUTTER_MARGIN = spacing.xs;

/** A weekday's short name in the app language, Sunday 0. */
function weekdayName(row: number): string {
  // 1 January 2023 was a Sunday.
  return new Date(2023, 0, 1 + row).toLocaleDateString(getIntlLocale(), { weekday: 'short' });
}

/** The first column the viewport shows, from the scroll offset. */
function columnAt(offset: number): number {
  return Math.floor(Math.max(0, offset) / HEATMAP_PITCH);
}

export const ActivityHeatmap = React.forwardRef<ActivityHeatmapHandle, ActivityHeatmapProps>(
  function ActivityHeatmap(_props, ref) {
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
      const map = new Map<string, { intensity: number; activityCount: number }>();
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
    }, [grid, intensities, intensityColors, dividerColor]);

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
        scrollRef.current.scrollTo({ x: scrollX, animated: true });
      }
    }, [highlightPos]);

    // Show empty state when the drawn range holds nothing. The cache is the
    // source, so an empty grid and no activities are the same thing, and the
    // census says whether that is the account or a range never downloaded.
    if (totalActivities === 0) {
      const notDownloaded = coverage === RangeCoverage.NotFetched;
      return (
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={[styles.title, isDark && styles.textLight]}>
              {t('stats.activityCalendar')}
            </Text>
          </View>
          {/* Until the first answer there is nothing to say about the range. */}
          <View style={styles.emptyState}>
            {!isPending && (
              <Text style={[styles.emptyText, isDark && styles.textDark]}>
                {notDownloaded ? t('stats.rangeNotDownloaded') : t('stats.noActivityData')}
              </Text>
            )}
            {!isPending && !notDownloaded && (
              <Text style={[styles.emptyHint, isDark && styles.textDark]}>
                {t('stats.completeActivitiesHeatmap')}
              </Text>
            )}
          </View>
        </View>
      );
    }

    return (
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={[styles.title, isDark && styles.textLight]}>
              {t('stats.activityCalendar')}
            </Text>
            <Text testID="activity-heatmap-range" style={[styles.range, isDark && styles.textDark]}>
              {labels.range}
            </Text>
          </View>
          <Text
            testID="activity-heatmap-count"
            style={[styles.subtitle, isDark && styles.textDark]}
          >
            {t('stats.activitiesCount', { count: totalActivities })}
          </Text>
        </View>

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
                <Canvas style={{ width: GRID_WIDTH, height: GRID_HEIGHT }}>
                  <Picture picture={heatmapPicture} />
                </Canvas>
                {highlightPos && (
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
                )}
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

        {/* Legend */}
        <View style={styles.legend}>
          <Text style={[styles.legendLabel, isDark && styles.textDark]}>{t('stats.less')}</Text>
          {intensityColors.map((color, idx) => (
            <View
              key={idx}
              style={[
                styles.legendCell,
                { backgroundColor: color, width: CELL_SIZE, height: CELL_SIZE },
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
  range: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    marginTop: spacing.xxs,
  },
  partial: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  body: {
    flexDirection: 'row',
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
    borderRadius: layout.borderRadiusXs,
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
