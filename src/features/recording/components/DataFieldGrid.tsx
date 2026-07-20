import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import type { ViewStyle } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import {
  formatDistance,
  formatDuration,
  formatSpeed,
  formatPace,
  formatElevation,
} from '@/shared/format/format';
import { colors, colorWithOpacity, darkColors, spacing } from '@/theme';
import type { DataFieldType } from '@/types';

export interface HrZoneInfo {
  color: string;
  zone: number;
}

interface RecordingMetrics {
  speed: number;
  avgSpeed: number;
  distance: number;
  heartrate: number;
  power: number;
  cadence: number;
  elevation: number;
  elevationGain: number;
  pace: number;
  avgPace: number;
  calories: number;
  lapDistance: number;
  lapTime: number;
  elapsedTime: number;
  movingTime: number;
}

interface DataFieldGridProps {
  fields: DataFieldType[];
  metrics: RecordingMetrics;
  isMetric: boolean;
  /** Live HR zone; tints the heart-rate tile so effort reads at a glance. */
  hrZone?: HrZoneInfo | null;
  /** Long-press a tile to swap its field in place. */
  onLongPressField?: (index: number, field: DataFieldType) => void;
  style?: ViewStyle;
}

function formatFieldValue(
  field: DataFieldType,
  metrics: RecordingMetrics,
  isMetric: boolean
): string {
  switch (field) {
    case 'speed':
      return formatSpeed(metrics.speed, isMetric);
    case 'avgSpeed':
      return formatSpeed(metrics.avgSpeed, isMetric);
    case 'distance':
      return formatDistance(metrics.distance, isMetric);
    case 'heartrate': {
      const bpm = Math.round(metrics.heartrate);
      return Number.isFinite(bpm) && bpm > 0 ? `${bpm} bpm` : '-- bpm';
    }
    case 'power': {
      const w = Math.round(metrics.power);
      return Number.isFinite(w) && w > 0 ? `${w} W` : '-- W';
    }
    case 'cadence': {
      const rpm = Math.round(metrics.cadence);
      return Number.isFinite(rpm) && rpm > 0 ? `${rpm} rpm` : '-- rpm';
    }
    case 'elevation':
      return formatElevation(metrics.elevation, isMetric);
    case 'elevationGain':
      return formatElevation(metrics.elevationGain, isMetric);
    case 'pace':
      return formatPace(metrics.pace, isMetric);
    case 'avgPace':
      return formatPace(metrics.avgPace, isMetric);
    case 'calories': {
      const kcal = Math.round(metrics.calories);
      return Number.isFinite(kcal) && kcal >= 0 ? `${kcal} kcal` : '0 kcal';
    }
    case 'lapDistance':
      return formatDistance(metrics.lapDistance, isMetric);
    case 'lapTime':
      return formatDuration(metrics.lapTime);
    case 'timer':
      return formatDuration(metrics.elapsedTime);
    case 'movingTime':
      return formatDuration(metrics.movingTime);
    default:
      return '--';
  }
}

function DataFieldGridInner({
  fields,
  metrics,
  isMetric,
  hrZone,
  onLongPressField,
  style,
}: DataFieldGridProps) {
  const { t } = useTranslation();
  const { isDark, colors: themeColors } = useTheme();

  return (
    <View style={[styles.grid, style]}>
      {fields.map((field, index) => {
        const zoned = field === 'heartrate' && hrZone != null;
        return (
          <Pressable
            key={field}
            testID={`data-field-${field}`}
            onLongPress={onLongPressField ? () => onLongPressField(index, field) : undefined}
            delayLongPress={350}
            style={[
              styles.cell,
              {
                backgroundColor: zoned
                  ? colorWithOpacity(hrZone.color, isDark ? 0.28 : 0.18)
                  : isDark
                    ? darkColors.surfaceElevated
                    : colors.surface,
                borderColor: isDark ? darkColors.border : colors.border,
              },
            ]}
          >
            <Text
              style={[styles.value, { color: zoned ? hrZone.color : themeColors.text }]}
              numberOfLines={1}
            >
              {formatFieldValue(field, metrics, isMetric)}
            </Text>
            <Text style={[styles.label, { color: themeColors.textMuted }]} numberOfLines={1}>
              {zoned
                ? `${t(`recording.fields.${field}`)} · Z${hrZone.zone}`
                : t(`recording.fields.${field}`)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export const DataFieldGrid = React.memo(DataFieldGridInner);

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    width: '50%',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  value: {
    fontSize: 24,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  label: {
    fontSize: 12,
    fontWeight: '400',
    marginTop: 2,
  },
});
