import React from 'react';
import { View, StyleSheet } from 'react-native';
import { TIME_RANGES } from '@/shared/app/constants';
import { ToggleButton } from '@/shared/ui';
import { spacing } from '@/theme';
import { type TimeRange } from '@/features/wellness';
import { useTranslation } from 'react-i18next';

interface TimeRangeSelectorProps {
  timeRange: TimeRange;
  onTimeRangeChange: (range: TimeRange) => void;
  isDark: boolean;
}

/**
 * Pill-button group for selecting a fitness time range (1W/1M/3M/6M/1Y).
 * It carries no outer margin, so the row that holds it sets the spacing.
 */
export const TimeRangeSelector = React.memo(function TimeRangeSelector({
  timeRange,
  onTimeRangeChange,
}: TimeRangeSelectorProps) {
  const { t } = useTranslation();
  return (
    <View testID="fitness-time-range-selector" style={styles.timeRangeContainer}>
      {TIME_RANGES.map((range) => (
        <ToggleButton
          key={range.id}
          testID={`fitness-range-${range.id}`}
          label={t(range.labelKey as never)}
          selected={timeRange === range.id}
          onPress={() => onTimeRangeChange(range.id)}
        />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  timeRangeContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.xs,
  },
});
