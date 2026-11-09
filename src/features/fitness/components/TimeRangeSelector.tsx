import React from 'react';
import { View, StyleSheet } from 'react-native';
import { TIME_RANGES } from '@/shared/app/constants';
import { ToggleButton } from '@/shared/ui';
import { colors, darkColors, spacing, layout, stroke } from '@/theme';
import { type TimeRange } from '@/features/wellness';
import { useTranslation } from 'react-i18next';

interface TimeRangeSelectorProps {
  timeRange: TimeRange;
  onTimeRangeChange: (range: TimeRange) => void;
  isDark: boolean;
}

/**
 * One segmented bar for the fitness time range (1W/1M/3M/6M/1Y). Grey chips
 * floating on the page read as decoration, so the ranges share one bordered
 * track the width of the column, the chosen one filled and the rest in body ink.
 * It carries no outer margin, so the row that holds it sets the spacing.
 */
export const TimeRangeSelector = React.memo(function TimeRangeSelector({
  timeRange,
  onTimeRangeChange,
  isDark,
}: TimeRangeSelectorProps) {
  const { t } = useTranslation();
  const palette = isDark ? darkColors : colors;
  return (
    <View
      testID="fitness-time-range-selector"
      style={[
        styles.track,
        { backgroundColor: palette.fillNeutral, borderColor: palette.controlBoundary },
      ]}
    >
      {TIME_RANGES.map((range) => (
        <ToggleButton
          key={range.id}
          testID={`fitness-range-${range.id}`}
          label={t(range.labelKey as never)}
          selected={timeRange === range.id}
          strongLabel
          onPress={() => onTimeRangeChange(range.id)}
          style={styles.segment}
        />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    padding: spacing.xxs,
    gap: spacing.xxs,
    borderRadius: layout.borderRadius,
    borderWidth: stroke.one,
  },
  segment: {
    flex: 1,
  },
});
