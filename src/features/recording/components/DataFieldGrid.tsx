import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import type { ViewStyle } from 'react-native';
import { Text } from 'react-native-paper';

import { DENSE_TEXT_SCALE } from '@/shared/ui/DenseText';
import * as haptics from '@/shared/ui/haptics';
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
import { DELIBERATE_HOLD_MS } from '@/shared/ui/holdDurations';

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

/**
 * A live value never ellipsises: it shrinks to fit its cell, down to this
 * fraction of its size, so the reading stays whole.
 */
const VALUE_MIN_FONT_SCALE = 0.5;

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

interface DataFieldTileProps {
  field: DataFieldType;
  index: number;
  value: string;
  label: string;
  zone: number | undefined;
  zoneColor: string | undefined;
  emptyKind: SensorKind | undefined;
  isDark: boolean;
  textColor: string;
  mutedColor: string;
  onLongPressField?: ((index: number, field: DataFieldType) => void) | undefined;
  onEmptySensorTap?: ((kind: SensorKind) => void) | undefined;
}

const DataFieldTile = React.memo(function DataFieldTile({
  field,
  index,
  value,
  label,
  zone,
  zoneColor,
  emptyKind,
  isDark,
  textColor,
  mutedColor,
  onLongPressField,
  onEmptySensorTap,
}: DataFieldTileProps) {
  const handleLongPress = React.useCallback(() => {
    haptics.light();
    onLongPressField?.(index, field);
  }, [onLongPressField, index, field]);
  const handleEmptyTap = React.useCallback(() => {
    if (emptyKind) onEmptySensorTap?.(emptyKind);
  }, [emptyKind, onEmptySensorTap]);
  const zoned = zone != null && zoneColor != null;

  return (
    <Pressable
      testID={`data-field-${field}`}
      onPress={emptyKind ? handleEmptyTap : undefined}
      onLongPress={onLongPressField ? handleLongPress : undefined}
      delayLongPress={DELIBERATE_HOLD_MS}
      accessibilityRole={emptyKind ? 'button' : undefined}
      style={pressable([
        styles.cell,
        {
          backgroundColor: zoned
            ? colorWithOpacity(zoneColor, isDark ? 0.28 : 0.18)
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
        style={[styles.value, { color: zoned ? hrZoneTextColor(zone, isDark) : textColor }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={VALUE_MIN_FONT_SCALE}
      >
        {value}
      </Text>
      <View style={styles.labelRow}>
        <Text
          maxFontSizeMultiplier={DENSE_TEXT_SCALE}
          style={[styles.label, { color: mutedColor }]}
          numberOfLines={1}
        >
          {label}
        </Text>
        {zoned ? (
          <Text
            maxFontSizeMultiplier={DENSE_TEXT_SCALE}
            style={[styles.label, styles.zone, { color: hrZoneTextColor(zone, isDark) }]}
            numberOfLines={1}
          >
            {`Z${zone}`}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
});

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
        const zone = field === 'heartrate' ? hrZone?.zone : undefined;
        return (
          <DataFieldTile
            key={field}
            field={field}
            index={index}
            value={formatFieldValue(field, metrics, isMetric, activityType)}
            label={t(`recording.fields.${field}`)}
            zone={zone}
            zoneColor={zone != null ? hrZone?.color : undefined}
            emptyKind={emptyKind}
            isDark={isDark}
            textColor={themeColors.text}
            mutedColor={themeColors.textSecondary}
            onLongPressField={onLongPressField}
            onEmptySensorTap={onEmptySensorTap}
          />
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
  labelRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    maxWidth: '100%',
    marginTop: spacing.xxs,
  },
  label: {
    flexShrink: 1,
    fontSize: typography.caption.fontSize,
    fontWeight: '400',
  },
  zone: {
    flexShrink: 0,
    fontWeight: '700',
    marginLeft: spacing.xs,
  },
});
