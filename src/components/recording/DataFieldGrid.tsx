import React from 'react';
import { View, StyleSheet } from 'react-native';
import type { ViewStyle } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks';
import { formatDistance, formatDuration, formatSpeed, formatPace, formatElevation } from '@/lib';
import { colors, darkColors, spacing } from '@/theme';
import type { DataFieldType } from '@/types';

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
}

interface DataFieldGridProps {
  fields: DataFieldType[];
  metrics: RecordingMetrics;
  isMetric: boolean;
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
    case 'movingTime':
      return formatDuration(0);
    default:
      return '--';
  }
}

function DataFieldGridInner({ fields, metrics, isMetric, style }: DataFieldGridProps) {
  const { t } = useTranslation();
  const { isDark, colors: themeColors } = useTheme();

  return (
    <View style={[styles.grid, style]}>
      {fields.map((field) => (
        <View
          key={field}
          style={[
            styles.cell,
            {
              backgroundColor: isDark ? darkColors.surfaceElevated : colors.surface,
              borderColor: isDark ? darkColors.border : colors.border,
            },
          ]}
        >
          <Text style={[styles.value, { color: themeColors.text }]} numberOfLines={1}>
            {formatFieldValue(field, metrics, isMetric)}
          </Text>
          <Text style={[styles.label, { color: themeColors.textMuted }]} numberOfLines={1}>
            {t(`recording.fields.${field}`)}
          </Text>
        </View>
      ))}
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
