import React, { useRef, useCallback } from 'react';
import { View, StyleSheet, Pressable, Text } from 'react-native';
import { useTheme } from '@/hooks';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, typography, layout, spacing } from '@/theme';
import type { ChartConfig, ChartTypeId } from '@/lib';

/** Chart type translation key type */
type ChartTypeKey =
  | 'chartTypes.power'
  | 'chartTypes.hr'
  | 'chartTypes.cad'
  | 'chartTypes.speed'
  | 'chartTypes.pace'
  | 'chartTypes.elev';

/** Map chart IDs to translation keys */
const CHART_LABEL_KEYS: Partial<Record<ChartTypeId, ChartTypeKey>> = {
  power: 'chartTypes.power',
  heartrate: 'chartTypes.hr',
  cadence: 'chartTypes.cad',
  speed: 'chartTypes.speed',
  pace: 'chartTypes.pace',
  elevation: 'chartTypes.elev',
};

interface ChartTypeSelectorProps {
  /** Available chart types (only those with data) */
  available: ChartConfig[];
  /** Currently selected chart type IDs */
  selected: string[];
  /** Toggle a chart type on/off */
  onToggle: (id: string) => void;
  /** Called when user starts long-pressing a chip (to preview Y-axis) */
  onPreviewStart?: (id: string) => void;
  /** Called when user stops long-pressing a chip */
  onPreviewEnd?: () => void;
}

/** Convert hex color to rgba with opacity */
function hexToRgba(hex: string, opacity: number): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return hex;
  const r = parseInt(result[1], 16);
  const g = parseInt(result[2], 16);
  const b = parseInt(result[3], 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

export function ChartTypeSelector({
  available,
  selected,
  onToggle,
  onPreviewStart,
  onPreviewEnd,
}: ChartTypeSelectorProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const isLongPressRef = useRef(false);

  const handlePressIn = useCallback(() => {
    isLongPressRef.current = false;
  }, []);

  const handleLongPress = useCallback(
    (id: string) => {
      isLongPressRef.current = true;
      onPreviewStart?.(id);
    },
    [onPreviewStart]
  );

  const handlePressOut = useCallback(() => {
    if (isLongPressRef.current) {
      onPreviewEnd?.();
    }
    isLongPressRef.current = false;
  }, [onPreviewEnd]);

  const handlePress = useCallback(
    (id: string) => {
      // Only toggle if it wasn't a long press
      if (!isLongPressRef.current) {
        onToggle(id);
      }
    },
    [onToggle]
  );

  if (available.length === 0) {
    return null;
  }

  // Use flexWrap instead of horizontal scroll to avoid gesture conflict with tab swipe
  return (
    <View style={styles.container} testID="chart-type-selector">
      {available.map((config) => {
        const isSelected = selected.includes(config.id);
        // Use full color when selected, faded color when unselected
        const bgColor = isSelected ? config.color : hexToRgba(config.color, isDark ? 0.25 : 0.15);
        const textColor = isSelected ? colors.textOnDark : config.color;
        // Use translated label if available, fallback to config.label
        const labelKey = CHART_LABEL_KEYS[config.id];
        const label = labelKey ? (t(labelKey) as string) : config.label;

        return (
          <Pressable
            key={config.id}
            testID={`chart-type-${config.id}`}
            style={({ pressed }) => [
              styles.chip,
              { backgroundColor: bgColor, opacity: pressed ? 0.7 : 1 },
            ]}
            onPressIn={handlePressIn}
            onPress={() => handlePress(config.id)}
            onLongPress={() => handleLongPress(config.id)}
            onPressOut={handlePressOut}
            delayLongPress={300}
          >
            <MaterialCommunityIcons name={config.icon} size={12} color={textColor} />
            <Text style={[styles.chipLabel, { color: textColor }]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: layout.borderRadius,
  },
  chipLabel: {
    fontSize: typography.caption.fontSize,
    fontWeight: '500',
  },
});
