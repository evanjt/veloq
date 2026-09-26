import React, { useImperativeHandle, useState } from 'react';
import { View, StyleSheet, Text, TouchableOpacity } from 'react-native';
import * as Haptics from 'expo-haptics';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  colors,
  darkColors,
  typography,
  shadows,
  layout,
  spacing,
  ink,
  colorWithOpacity,
} from '@/theme';
import { formatDuration } from '@/shared/format/format';

interface ChartDistanceIndicatorProps {
  xAxisMode: 'distance' | 'time';
  /** Maximum x-axis value, shown whenever no scrub is in flight. */
  maxX: number;
  /** Distance unit label (`km` or `mi`). Empty string for time mode. */
  xUnit: string;
  isDark: boolean;
  canToggleXAxis: boolean;
  onXAxisModeToggle?: () => void;
}

/** How the chart pushes a scrub position into the pill. */
export interface ChartDistanceIndicatorHandle {
  /**
   * The live scrub position, or null when the gesture ends. Zero is a
   * position, so the absent one has to be null rather than falsy.
   */
  setScrub: (x: number | null) => void;
}

/**
 * Bottom-right pill that shows the current x-axis value (distance or time).
 *
 * Tappable when {@link canToggleXAxis} is true and a toggle callback is
 * provided - the activity has both distance and time streams, so the user
 * can swap between modes. Otherwise renders as a static display.
 *
 * The scrub value is state of this component's own, pushed in through the
 * handle rather than passed as a prop. Held at the chart root it re-rendered
 * the whole chart on every index the gesture crossed, and the pill is the only
 * thing that draws it.
 */
export const ChartDistanceIndicator = React.memo(
  React.forwardRef<ChartDistanceIndicatorHandle, ChartDistanceIndicatorProps>(
    function ChartDistanceIndicator(
      { xAxisMode, maxX, xUnit, isDark, canToggleXAxis, onXAxisModeToggle },
      ref
    ) {
      const [scrub, setScrub] = useState<number | null>(null);
      useImperativeHandle(ref, () => ({ setScrub }), []);

      const displayValue =
        xAxisMode === 'time'
          ? formatDuration(scrub ?? maxX)
          : scrub !== null
            ? `${scrub.toFixed(2)} ${xUnit}`
            : `${maxX.toFixed(1)} ${xUnit}`;

      if (canToggleXAxis && onXAxisModeToggle) {
        return (
          <TouchableOpacity
            style={[
              styles.distanceIndicator,
              styles.distanceIndicatorTappable,
              isDark && styles.distanceIndicatorDark,
              isDark && styles.distanceIndicatorTappableDark,
            ]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onXAxisModeToggle();
            }}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={[styles.distanceText, isDark && styles.distanceTextDark]}>
              {displayValue}
            </Text>
            <MaterialCommunityIcons
              name="swap-horizontal"
              size={12}
              color={isDark ? darkColors.textSecondary : colors.textSecondary}
              style={styles.swapIcon}
            />
          </TouchableOpacity>
        );
      }

      return (
        <View
          style={[styles.distanceIndicator, isDark && styles.distanceIndicatorDark]}
          pointerEvents="none"
        >
          <Text style={[styles.distanceText, isDark && styles.distanceTextDark]}>
            {displayValue}
          </Text>
        </View>
      );
    }
  )
);

const styles = StyleSheet.create({
  distanceIndicator: {
    position: 'absolute',
    bottom: 24,
    right: 8,
    backgroundColor: colorWithOpacity(ink.white, 0.9),
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: layout.borderRadiusSm,
    // Platform-optimized shadow
    ...shadows.pill,
  },
  distanceIndicatorTappable: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: colorWithOpacity(ink.black, 0.1),
  },
  distanceIndicatorTappableDark: {
    borderColor: colorWithOpacity(ink.white, 0.15),
  },
  distanceIndicatorDark: {
    backgroundColor: darkColors.surfaceOverlay,
  },
  swapIcon: {
    marginLeft: spacing.xs,
  },
  distanceText: {
    fontSize: typography.label.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  distanceTextDark: {
    color: darkColors.textPrimary,
  },
});
