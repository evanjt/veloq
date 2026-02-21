import React, { useRef, useCallback } from 'react';
import { View, StyleSheet, Pressable, Text } from 'react-native';
import { useTheme } from '@/hooks';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, typography, layout, spacing } from '@/theme';
import { CHART_CONFIG } from '@/constants';
import type { ChartConfig, ChartTypeId } from '@/lib';

/** Chart type translation key type */
type ChartTypeKey =
  | 'chartTypes.power'
  | 'chartTypes.hr'
  | 'chartTypes.cad'
  | 'chartTypes.speed'
  | 'chartTypes.pace'
  | 'chartTypes.elev'
  | 'chartTypes.grade';

/** Map chart IDs to translation keys */
const CHART_LABEL_KEYS: Partial<Record<ChartTypeId, ChartTypeKey>> = {
  power: 'chartTypes.power',
  heartrate: 'chartTypes.hr',
  cadence: 'chartTypes.cad',
  speed: 'chartTypes.speed',
  pace: 'chartTypes.pace',
  elevation: 'chartTypes.elev',
  grade: 'chartTypes.grade',
};

interface ChartMetricDisplay {
  id: string;
  value: string;
  unit: string;
  /** Longest formatted value for stable width */
  maxValueWidth?: string;
}

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
  /** Per-chart metric values to display inside chips (avg or scrub position) */
  metricValues?: ChartMetricDisplay[];
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
  metricValues,
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
        // Get metric value for this chip
        const metric = metricValues?.find((m) => m.id === config.id);

        return (
          <Pressable
            key={config.id}
            testID={`chart-type-${config.id}`}
            style={({ pressed }) => [
              styles.chip,
              metric && styles.chipWithValue,
              { backgroundColor: bgColor, opacity: pressed ? 0.7 : 1 },
            ]}
            onPressIn={handlePressIn}
            onPress={() => handlePress(config.id)}
            onLongPress={() => handleLongPress(config.id)}
            onPressOut={handlePressOut}
            delayLongPress={CHART_CONFIG.LONG_PRESS_DURATION}
          >
            <View style={styles.chipLabelRow}>
              <MaterialCommunityIcons name={config.icon} size={11} color={textColor} />
              <Text style={[styles.chipLabel, { color: textColor }]}>{label}</Text>
            </View>
            {metric && (
              <View style={styles.chipValueContainer}>
                {/* Hidden max-width text to reserve stable chip width */}
                <Text style={[styles.chipValue, styles.chipValueHidden]} numberOfLines={1}>
                  {metric.maxValueWidth || metric.value}
                  {metric.unit ? ` ${metric.unit}` : ''}
                </Text>
                {/* Visible value centered on top */}
                <Text
                  style={[styles.chipValue, styles.chipValueVisible, { color: textColor }]}
                  numberOfLines={1}
                >
                  {metric.value}
                  {metric.unit ? ` ${metric.unit}` : ''}
                </Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const VALUE_FONT_SIZE = 10;

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'stretch',
    gap: 6,
  },
  chip: {
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: layout.borderRadius,
  },
  chipWithValue: {
    paddingVertical: 3,
  },
  chipLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  chipLabel: {
    fontSize: 11,
    fontWeight: '500',
  },
  chipValueContainer: {
    alignSelf: 'stretch',
    alignItems: 'center',
    marginTop: 1,
  },
  chipValue: {
    fontSize: VALUE_FONT_SIZE,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  chipValueHidden: {
    opacity: 0,
  },
  chipValueVisible: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    textAlign: 'center',
  },
});
