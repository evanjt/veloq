import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import type { ViewStyle } from 'react-native';
import { Text } from 'react-native-paper';

import { DENSE_TEXT_SCALE } from '@/shared/ui/DenseText';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import {
  formatDistance,
  formatDuration,
  formatSpeed,
  formatPace,
  formatSportSpeed,
  formatElevation,
} from '@/shared/format/format';
import { colors, colorWithOpacity, darkColors, spacing, typography } from '@/theme';
import type { ActivityType, DataFieldType } from '@/types';
import { isSwimmingActivity } from '@/shared/activity/activityUtils';
import { pressable, pressRipple } from '@/shared/ui';
import type { SensorKind } from '@/features/sensors';
import { hrZoneTextColor } from '../lib/hrZoneTextColor';

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
  elevation: number | null;
  elevationGain: number;
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
  /** Sport being recorded; a swim reads its pace per 100 m or 100 yd. */
  activityType?: ActivityType | null | undefined;
  /** Live HR zone; tints the heart-rate tile so effort reads at a glance. */
  hrZone?: HrZoneInfo | null;
  /** Long-press a tile to swap its field in place. */
  onLongPressField?: ((index: number, field: DataFieldType) => void) | undefined;
  /** Tap on a heart rate, power or cadence tile that has no value: pair that kind of sensor. */
  onEmptySensorTap?: ((kind: SensorKind) => void) | undefined;
  style?: ViewStyle;
}

const SENSOR_FIELD_KIND: Partial<Record<DataFieldType, SensorKind>> = {
  heartrate: 'heartRate',
  power: 'power',
  cadence: 'cadence',
};

function formatFieldValue(
  field: DataFieldType,
  metrics: RecordingMetrics,
  isMetric: boolean,
  activityType: ActivityType | null | undefined
): string {
  const swimming = activityType != null && isSwimmingActivity(activityType);
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
      if (metrics.elevation == null) return isMetric ? '-- m' : '-- ft';
      return formatElevation(metrics.elevation, isMetric);
    case 'elevationGain':
      return formatElevation(metrics.elevationGain, isMetric);
    // The formatter takes metres per second and owns the conversion for both
    // unit systems, so the pace tiles read the speeds.
    case 'pace':
      return swimming
        ? formatSportSpeed(metrics.speed, activityType, isMetric)
        : formatPace(metrics.speed, isMetric);
    case 'avgPace':
      return swimming
        ? formatSportSpeed(metrics.avgSpeed, activityType, isMetric)
        : formatPace(metrics.avgSpeed, isMetric);
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
  activityType,
  hrZone,
  onLongPressField,
  onEmptySensorTap,
  style,
}: DataFieldGridProps) {
  const { t } = useTranslation();
  const { isDark, colors: themeColors } = useTheme();

  return (
    <View style={[styles.grid, style]}>
      {fields.map((field, index) => {
        const sensorKind = SENSOR_FIELD_KIND[field];
        const metricValue =
          field === 'heartrate'
            ? metrics.heartrate
            : field === 'power'
              ? metrics.power
              : metrics.cadence;
        const emptyKind =
          onEmptySensorTap && sensorKind && !(Math.round(metricValue) > 0) ? sensorKind : undefined;
        const zoned = field === 'heartrate' && hrZone != null;
        return (
          <Pressable
            key={field}
            testID={`data-field-${field}`}
            onPress={emptyKind ? () => onEmptySensorTap?.(emptyKind) : undefined}
            onLongPress={onLongPressField ? () => onLongPressField(index, field) : undefined}
            delayLongPress={350}
            style={pressable([
              styles.cell,
              {
                backgroundColor: zoned
                  ? colorWithOpacity(hrZone.color, isDark ? 0.28 : 0.18)
                  : isDark
                    ? darkColors.surfaceElevated
                    : colors.surface,
                borderColor: isDark ? darkColors.border : colors.border,
              },
            ])}
            android_ripple={pressRipple}
          >
            <Text
              maxFontSizeMultiplier={DENSE_TEXT_SCALE}
              style={[
                styles.value,
                { color: zoned ? hrZoneTextColor(hrZone.zone, isDark) : themeColors.text },
              ]}
              numberOfLines={1}
            >
              {formatFieldValue(field, metrics, isMetric, activityType)}
            </Text>
            <Text
              maxFontSizeMultiplier={DENSE_TEXT_SCALE}
              style={[styles.label, { color: themeColors.textMuted }]}
              numberOfLines={1}
            >
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
    fontSize: typography.statsValueLarge.fontSize,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  label: {
    fontSize: typography.caption.fontSize,
    fontWeight: '400',
    marginTop: spacing.xxs,
  },
});
