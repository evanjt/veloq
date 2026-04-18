import React from 'react';
import { View, StyleSheet, Text, TouchableOpacity } from 'react-native';
import * as Haptics from 'expo-haptics';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, darkColors, typography, shadows } from '@/theme';
import { formatDuration } from '@/lib';

interface ChartDistanceIndicatorProps {
  xAxisMode: 'distance' | 'time';
  /** Live scrub value along the x-axis (distance in display units, or time in seconds). */
  currentX: number | null;
  /** Whether the user is currently scrubbing — drives display of currentX vs maxX. */
  isActive: boolean;
  /** Maximum x-axis value, used as the default display when not scrubbing. */
  maxX: number;
  /** Distance unit label (`km` or `mi`). Empty string for time mode. */
  xUnit: string;
  isDark: boolean;
  canToggleXAxis: boolean;
  onXAxisModeToggle?: () => void;
}

/**
 * Bottom-right pill that shows the current x-axis value (distance or time).
 *
 * Tappable when {@link canToggleXAxis} is true and a toggle callback is
 * provided — the activity has both distance and time streams, so the user
 * can swap between modes. Otherwise renders as a static display.
 */
export const ChartDistanceIndicator = React.memo(function ChartDistanceIndicator({
  xAxisMode,
  currentX,
  isActive,
  maxX,
  xUnit,
  isDark,
  canToggleXAxis,
  onXAxisModeToggle,
}: ChartDistanceIndicatorProps) {
  const displayValue =
    xAxisMode === 'time'
      ? formatDuration(isActive && currentX !== null ? currentX : maxX)
      : isActive && currentX !== null
        ? `${currentX.toFixed(2)} ${xUnit}`
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
        <Text style={[styles.distanceText, isDark && styles.distanceTextDark]}>{displayValue}</Text>
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
      <Text style={[styles.distanceText, isDark && styles.distanceTextDark]}>{displayValue}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  distanceIndicator: {
    position: 'absolute',
    bottom: 24,
    right: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    // Platform-optimized shadow
    ...shadows.pill,
  },
  distanceIndicatorTappable: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.1)',
  },
  distanceIndicatorTappableDark: {
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  distanceIndicatorDark: {
    backgroundColor: darkColors.surfaceOverlay,
  },
  swapIcon: {
    marginLeft: 3,
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
