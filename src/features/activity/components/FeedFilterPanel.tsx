/**
 * The feed's filter panel, pinned above the list.
 *
 * Open, it holds a two-handle bar each for the date, the distance and the
 * duration over the library's own span, the date presets as quick taps and the
 * sport chips. Collapsed, it is one row naming what is set, each chip clearing
 * its own filter and reopening its bar on a tap, with the count on the right.
 * Every filter is additive, and the panel is nothing while none is set and it is
 * shut.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { useMetricSystem, useTheme } from '@/shared/app';
import {
  formatDateSpan,
  formatDistance,
  formatDuration,
  epochDayKeyUtc,
  formatLocalDate,
} from '@/shared/format/format';
import { Icon } from '@/shared/ui/Icon';
import { IconButton, ToggleButton } from '@/shared/ui';
import { RangeBar } from '@/shared/ui/RangeBar';
import { addDaysToDay } from '@/shared/time/startDate';
import { colors, controlHeight, darkColors, iconSize, layout, spacing, typography } from '@/theme';
import { FEED_GROUP_LABELS, type FeedGroup } from '../lib/feedActivityGroups';
import {
  feedFilterChips,
  numericRangeFor,
  type FeedFilter,
  type FeedFilterChip,
  type FeedFilterChipKind,
  type MeasureBounds,
  type NumericRange,
} from '../lib/feedFilter';
import {
  FEED_RANGE_PRESETS,
  feedRangeForPreset,
  sameFeedRange,
  type FeedRange,
  type FeedRangePreset,
} from '../lib/feedRange';
import { FeedFilterChips, FeedRangePresets } from './FeedFilterChips';

/** What the engine reports of the library, any part of which an empty library lacks. */
export interface FeedFilterSpan {
  oldestTs?: number | undefined;
  newestTs?: number | undefined;
  minDistance?: number | undefined;
  maxDistance?: number | undefined;
  minMovingTime?: number | undefined;
  maxMovingTime?: number | undefined;
}

interface FeedFilterPanelProps {
  filter: FeedFilter;
  span: FeedFilterSpan | null | undefined;
  expanded: boolean;
  /** The count of activities the filters leave. */
  matchedCount: number;
  onExpand: () => void;
  onCollapse: () => void;
  onRange: (range: FeedRange | null) => void;
  onDistance: (range: NumericRange | null) => void;
  onDuration: (range: NumericRange | null) => void;
  onToggleGroup: (group: FeedGroup) => void;
  onClearName: () => void;
}

const dayOf = epochDayKeyUtc;

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

function measureBounds(min?: number, max?: number): MeasureBounds | null {
  return min !== undefined && max !== undefined && max > min ? { min, max } : null;
}

interface MeasureRowProps {
  testID: string;
  title: string;
  bounds: MeasureBounds;
  value: NumericRange | null;
  format: (value: number) => string;
  lowLabel: string;
  highLabel: string;
  onCommit: (range: NumericRange | null) => void;
}

/** One bar with its title and the two values it holds, which follow a handle as it moves. */
function MeasureRow({
  testID,
  title,
  bounds,
  value,
  format,
  lowLabel,
  highLabel,
  onCommit,
}: MeasureRowProps) {
  const { isDark } = useTheme();
  const [live, setLive] = useState<NumericRange | null>(null);
  const shown = live ?? value ?? { low: bounds.min, high: bounds.max };
  const commit = useCallback(
    (low: number, high: number) => {
      setLive(null);
      onCommit(numericRangeFor(low, high, bounds));
    },
    [bounds, onCommit]
  );
  const onChange = useCallback((low: number, high: number) => setLive({ low, high }), []);
  const ink = isDark ? darkColors.textPrimary : colors.textPrimary;
  const quiet = isDark ? darkColors.textSecondary : colors.textSecondary;
  return (
    <View testID={testID} style={styles.measure}>
      <View style={styles.measureHead}>
        <Text style={[styles.measureTitle, { color: quiet }]}>{title}</Text>
        <Text testID={`${testID}-value`} style={[styles.measureValue, { color: ink }]}>
          {format(shown.low)} – {format(shown.high)}
        </Text>
      </View>
      <RangeBar
        testID={`${testID}-bar`}
        min={bounds.min}
        max={bounds.max}
        low={shown.low}
        high={shown.high}
        onChange={onChange}
        onCommit={commit}
        formatValue={format}
        lowLabel={lowLabel}
        highLabel={highLabel}
      />
    </View>
  );
}

/** The chips naming what is set, worded for the app language and the athlete's units. */
export function useFeedFilterChips(filter: FeedFilter): FeedFilterChip[] {
  const { t } = useTranslation();
  const isMetric = useMetricSystem();
  return useMemo(
    () =>
      feedFilterChips(filter, {
        date: (range) => formatDateSpan(range.oldest, range.newest),
        distance: (range) =>
          `${formatDistance(range.low, isMetric)} – ${formatDistance(range.high, isMetric)}`,
        duration: (range) => `${formatDuration(range.low)} – ${formatDuration(range.high)}`,
        sport: (group) => t(FEED_GROUP_LABELS[group]),
      }),
    [filter, isMetric, t]
  );
}

export function FeedFilterPanel({
  filter,
  span,
  expanded,
  matchedCount,
  onExpand,
  onCollapse,
  onRange,
  onDistance,
  onDuration,
  onToggleGroup,
  onClearName,
}: FeedFilterPanelProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();

  const formatDistanceValue = useCallback((m: number) => formatDistance(m, isMetric), [isMetric]);
  const chips = useFeedFilterChips(filter);

  const today = formatLocalDate(new Date());
  const selectedPreset = useMemo<FeedRangePreset | null>(
    () =>
      FEED_RANGE_PRESETS.find((preset) =>
        sameFeedRange(filter.range, feedRangeForPreset(preset, today))
      ) ?? null,
    [filter.range, today]
  );
  const selectPreset = useCallback(
    (preset: FeedRangePreset) =>
      onRange(preset === selectedPreset ? null : feedRangeForPreset(preset, today)),
    [onRange, selectedPreset, today]
  );

  const oldestDay = span?.oldestTs !== undefined ? dayOf(span.oldestTs) : null;
  const newestDay = span?.newestTs !== undefined ? dayOf(span.newestTs) : null;
  const dateBounds = useMemo(
    () => (oldestDay && newestDay ? measureBounds(0, daysBetween(oldestDay, newestDay)) : null),
    [oldestDay, newestDay]
  );
  const dateValue = useMemo<NumericRange | null>(
    () =>
      filter.range && oldestDay
        ? {
            low: Math.max(0, daysBetween(oldestDay, filter.range.oldest)),
            high: Math.max(0, daysBetween(oldestDay, filter.range.newest)),
          }
        : null,
    [filter.range, oldestDay]
  );
  const dayLabel = useCallback(
    (index: number) =>
      oldestDay ? formatDateSpan(addDaysToDay(oldestDay, Math.round(index)), null) : '',
    [oldestDay]
  );
  const commitDate = useCallback(
    (range: NumericRange | null) => {
      if (!range || !oldestDay || !newestDay) {
        onRange(null);
        return;
      }
      // The open end follows the calendar, so an activity synced after this read is inside it.
      const newest = range.high >= (dateBounds?.max ?? 0) && newestDay < today ? today : null;
      onRange({
        oldest: addDaysToDay(oldestDay, Math.round(range.low)),
        newest: newest ?? addDaysToDay(oldestDay, Math.round(range.high)),
      });
    },
    [oldestDay, newestDay, dateBounds, today, onRange]
  );

  const distanceBounds = measureBounds(span?.minDistance, span?.maxDistance);
  const durationBounds = measureBounds(span?.minMovingTime, span?.maxMovingTime);

  const clearChip = useCallback(
    (chip: FeedFilterChip) => {
      if (chip.kind === 'date') onRange(null);
      else if (chip.kind === 'distance') onDistance(null);
      else if (chip.kind === 'duration') onDuration(null);
      else if (chip.kind === 'sport' && chip.group) onToggleGroup(chip.group);
      else onClearName();
    },
    [onRange, onDistance, onDuration, onToggleGroup, onClearName]
  );

  const surface = isDark ? darkColors.surface : colors.surface;
  const ink = isDark ? darkColors.textPrimary : colors.textPrimary;
  const quiet = isDark ? darkColors.textSecondary : colors.textSecondary;

  if (!expanded && chips.length === 0) return null;

  if (!expanded) {
    return (
      <View
        testID="home-filter-panel"
        style={[styles.panel, styles.collapsed, { backgroundColor: surface }]}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          style={styles.chipScroller}
          contentContainerStyle={styles.chipRow}
        >
          {chips.map((chip) => (
            <RemovableChip
              key={`${chip.kind}-${chip.group ?? ''}`}
              chip={chip}
              onOpen={onExpand}
              onClear={clearChip}
              clearLabel={t('feed.filter.clear', { filter: chip.label })}
            />
          ))}
        </ScrollView>
        <Text testID="home-filter-count" style={[styles.count, { color: quiet }]}>
          {t('feed.activitiesCount', { count: matchedCount })}
        </Text>
      </View>
    );
  }

  return (
    <View testID="home-filter-panel" style={[styles.panel, { backgroundColor: surface }]}>
      <View style={styles.openHead}>
        <View style={styles.presets}>
          <FeedRangePresets selectedRange={selectedPreset} onSelectRange={selectPreset} />
        </View>
        {chips.length > 0 ? (
          <Text testID="home-filter-count" style={[styles.count, { color: quiet }]}>
            {t('feed.activitiesCount', { count: matchedCount })}
          </Text>
        ) : null}
        <IconButton
          testID="home-filter-panel-close"
          variant="ghost"
          accessibilityLabel={t('feed.filter.hide')}
          onPress={onCollapse}
        >
          <Icon name="chevron-up" size={iconSize.md} color={ink} />
        </IconButton>
      </View>
      {dateBounds ? (
        <MeasureRow
          testID="home-filter-date"
          title={t('feed.filter.date')}
          bounds={dateBounds}
          value={dateValue}
          format={dayLabel}
          lowLabel={t('feed.filter.dateFrom')}
          highLabel={t('feed.filter.dateTo')}
          onCommit={commitDate}
        />
      ) : null}
      {distanceBounds ? (
        <MeasureRow
          testID="home-filter-distance"
          title={t('feed.filter.distance')}
          bounds={distanceBounds}
          value={filter.distance}
          format={formatDistanceValue}
          lowLabel={t('feed.filter.distanceFrom')}
          highLabel={t('feed.filter.distanceTo')}
          onCommit={onDistance}
        />
      ) : null}
      {durationBounds ? (
        <MeasureRow
          testID="home-filter-duration"
          title={t('feed.filter.duration')}
          bounds={durationBounds}
          value={filter.duration}
          format={formatDuration}
          lowLabel={t('feed.filter.durationFrom')}
          highLabel={t('feed.filter.durationTo')}
          onCommit={onDuration}
        />
      ) : null}
      <FeedFilterChips selected={filter.groups} onSelect={onToggleGroup} />
    </View>
  );
}

interface RemovableChipProps {
  chip: FeedFilterChip;
  onOpen: () => void;
  onClear: (chip: FeedFilterChip) => void;
  clearLabel: string;
}

const chipTestID = (kind: FeedFilterChipKind, group?: FeedGroup) =>
  `home-filter-chip-${kind}${group ? `-${group.toLowerCase()}` : ''}`;

/** A chip naming one filter: a tap reopens its bar and the cross beside it clears it. */
function RemovableChip({ chip, onOpen, onClear, clearLabel }: RemovableChipProps) {
  const { isDark } = useTheme();
  const testID = chipTestID(chip.kind, chip.group);
  return (
    <View style={styles.chipPair}>
      <ToggleButton testID={testID} label={chip.label} selected onPress={onOpen} />
      <IconButton
        testID={`${testID}-clear`}
        variant="ghost"
        compact
        accessibilityLabel={clearLabel}
        onPress={() => onClear(chip)}
      >
        <Icon
          name="close"
          size={iconSize.sm}
          color={isDark ? darkColors.textPrimary : colors.textPrimary}
        />
      </IconButton>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    paddingHorizontal: layout.screenPadding,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
  },
  collapsed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingBottom: 0,
  },
  chipScroller: { flex: 1, flexGrow: 1 },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: controlHeight.chip,
  },
  chipPair: { flexDirection: 'row', alignItems: 'center' },
  count: { ...typography.caption, fontVariant: ['tabular-nums'] },
  openHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  presets: { flex: 1 },
  measure: { gap: spacing.xxs },
  measureHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  measureTitle: { ...typography.captionBold },
  measureValue: { ...typography.caption, fontVariant: ['tabular-nums'] },
});
