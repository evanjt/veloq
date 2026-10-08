import React, { useImperativeHandle, useState } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import * as haptics from '@/shared/ui/haptics';
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
import { Button } from '@/shared/ui';

interface ChartDistanceIndicatorProps {
  xAxisMode: 'distance' | 'time';
  /** Maximum x-axis value, shown whenever no scrub is in flight. */
  maxX: number;
  /** Distance unit label (`km` or `mi`). Empty string for time mode. */
  xUnit: string;
  isDark: boolean;
  canToggleXAxis: boolean;
  onXAxisModeToggle?: (() => void) | undefined;
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
          <Button
            label={displayValue}
            size="sm"
            variant="secondary"
            style={styles.distanceIndicatorButton}
            onPress={() => {
              haptics.selection();
              onXAxisModeToggle();
            }}
            icon={
              <MaterialCommunityIcons
                name="swap-horizontal"
                size={12}
                color={isDark ? darkColors.textSecondary : colors.textSecondary}
              />
            }
          />
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
    // Platform-optimised shadow
    ...shadows.pill,
  },
  distanceIndicatorButton: {
    position: 'absolute',
    bottom: 24,
    right: 8,
    ...shadows.pill,
  },
  distanceIndicatorDark: {
    backgroundColor: darkColors.surfaceOverlay,
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
