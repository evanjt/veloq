import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { TIME_RANGES } from '@/lib/utils/constants';
import { colors, darkColors, spacing, typography, opacity } from '@/theme';
import type { TimeRange } from '@/hooks';

interface TimeRangeSelectorProps {
  timeRange: TimeRange;
  onTimeRangeChange: (range: TimeRange) => void;
  isDark: boolean;
}

/**
 * Pill-button group for selecting a fitness time range (1W/1M/3M/6M/1Y).
 * Extracted from FitnessScreen — uses `TIME_RANGES` from `@/lib/utils/constants`.
 */
export const TimeRangeSelector = React.memo(function TimeRangeSelector({
  timeRange,
  onTimeRangeChange,
  isDark,
}: TimeRangeSelectorProps) {
  return (
    <View testID="fitness-time-range-selector" style={styles.timeRangeContainer}>
      {TIME_RANGES.map((range) => (
        <TouchableOpacity
          key={range.id}
          testID={`fitness-range-${range.id}`}
          style={[
            styles.timeRangeButton,
            isDark && styles.timeRangeButtonDark,
            timeRange === range.id && styles.timeRangeButtonActive,
          ]}
          onPress={() => onTimeRangeChange(range.id)}
          activeOpacity={0.7}
        >
          <Text
            style={[
              styles.timeRangeText,
              isDark && styles.timeRangeTextDark,
              timeRange === range.id && styles.timeRangeTextActive,
            ]}
          >
            {range.label}
          </Text>
        </TouchableOpacity>
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
    marginBottom: spacing.md,
  },
  timeRangeButton: {
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.xs,
    borderRadius: 14,
    backgroundColor: opacity.overlay.light,
  },
  timeRangeButtonDark: {
    backgroundColor: opacity.overlayDark.medium,
  },
  timeRangeButtonActive: {
    backgroundColor: colors.primary,
  },
  timeRangeText: {
    ...typography.caption,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  timeRangeTextDark: {
    color: darkColors.textSecondary,
  },
  timeRangeTextActive: {
    color: colors.textOnDark,
  },
});
