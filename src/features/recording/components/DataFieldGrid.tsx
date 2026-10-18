import React from 'react';
import { View, StyleSheet } from 'react-native';
import type { ViewStyle } from 'react-native';

import { DENSE_TEXT_SCALE } from '@/shared/ui/DenseText';
import * as haptics from '@/shared/ui/haptics';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import {
  formatCadence,
  formatCalories,
  formatDistance,
  formatDuration,
  formatHeartRate,
  formatPower,
  formatSpeed,
  formatPace,
  formatSportSpeed,
  formatElevation,
} from '@/shared/format/format';
import {
  colors,
  colorWithOpacity,
  darkColors,
  opacity,
  spacing,
  stroke,
  typography,
  zoneColour,
} from '@/theme';
import type { ActivityType, DataFieldType } from '@/types';
import { isSwimmingActivity } from '@/shared/activity/activityUtils';
import { accessibleActions, PressTarget } from '@/shared/ui';
import { FitText } from '@/shared/ui/FitText';
import { useTextScaleColumns } from '@/shared/ui/useLargeText';
import type { SensorKind } from '@/features/sensors';
import { DELIBERATE_HOLD_MS } from '@/shared/ui/holdDurations';
import { ABSENT, absentLabel } from '@/shared/format/absent';

export interface HrZoneInfo {
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

/** Tiles to a row at the default text size; past the dense cap each takes the full width. */
const GRID_COLUMNS = 2;

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
      return Number.isFinite(bpm) && bpm > 0 ? formatHeartRate(bpm) : ABSENT;
    }
    case 'power': {
      const w = Math.round(metrics.power);
      return Number.isFinite(w) && w > 0 ? formatPower(w) : ABSENT;
    }
    case 'cadence': {
      const rpm = Math.round(metrics.cadence);
      return Number.isFinite(rpm) && rpm > 0 ? formatCadence(rpm) : ABSENT;
    }
    case 'elevation':
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
    case 'calories':
      return formatCalories(metrics.calories);
    case 'lapDistance':
      return formatDistance(metrics.lapDistance, isMetric);
    case 'lapTime':
      return formatDuration(metrics.lapTime);
    case 'timer':
      return formatDuration(metrics.elapsedTime);
    case 'movingTime':
      return formatDuration(metrics.movingTime);
    default:
      return ABSENT;
  }
}

interface DataFieldTileProps {
  field: DataFieldType;
  index: number;
  value: string;
  label: string;
  zone: number | undefined;
  emptyKind: SensorKind | undefined;
  /** What the change-field action reads, the hold's only other way in. */
  changeFieldLabel: string;
  isDark: boolean;
  textColor: string;
  mutedColor: string;
  /** The tile's share of the row: half, or all of it at large text. */
  width: `${number}%`;
  onLongPressField?: ((index: number, field: DataFieldType) => void) | undefined;
  onEmptySensorTap?: ((kind: SensorKind) => void) | undefined;
}

const DataFieldTile = React.memo(function DataFieldTile({
  field,
  index,
  value,
  label,
  zone,
  emptyKind,
  changeFieldLabel,
  isDark,
  textColor,
  mutedColor,
  width,
  onLongPressField,
  onEmptySensorTap,
}: DataFieldTileProps) {
  const { t } = useTranslation();
  const handleLongPress = React.useCallback(() => {
    haptics.light();
    onLongPressField?.(index, field);
  }, [onLongPressField, index, field]);
  const handleEmptyTap = React.useCallback(() => {
    if (emptyKind) onEmptySensorTap?.(emptyKind);
  }, [emptyKind, onEmptySensorTap]);
  const zoned = zone != null;
  const actions = React.useMemo(
    () =>
      accessibleActions(
        onLongPressField
          ? [{ name: 'changeField', label: changeFieldLabel, run: handleLongPress }]
          : undefined
      ),
    [onLongPressField, changeFieldLabel, handleLongPress]
  );

  // Only an empty sensor tile does anything on a tap, so only it is a button.
  return (
    <PressTarget
      testID={`data-field-${field}`}
      onPress={emptyKind ? handleEmptyTap : undefined}
      onLongPress={onLongPressField ? handleLongPress : undefined}
      delayLongPress={DELIBERATE_HOLD_MS}
      accessibilityRole={emptyKind ? 'button' : undefined}
      accessibilityLabel={`${label}, ${absentLabel(value, t) ?? value}`}
      {...actions}
      style={[
        styles.cell,
        {
          width,
          backgroundColor: zoned
            ? colorWithOpacity(zoneColour(zone, isDark, 'fill'), opacity.tint3)
            : isDark
              ? darkColors.surfaceRaised
              : colors.surface,
          borderColor: isDark ? darkColors.border : colors.border,
        },
      ]}
    >
      <FitText
        maxFontSizeMultiplier={DENSE_TEXT_SCALE}
        style={[styles.value, { color: zoned ? zoneColour(zone, isDark, 'text') : textColor }]}
        minimumFontScale={VALUE_MIN_FONT_SCALE}
        accessibilityLabel={absentLabel(value, t)}
      >
        {value}
      </FitText>
      <View style={styles.labelRow}>
        <FitText
          maxFontSizeMultiplier={DENSE_TEXT_SCALE}
          style={[styles.label, { color: mutedColor }]}
        >
          {label}
        </FitText>
        {zoned ? (
          <FitText
            maxFontSizeMultiplier={DENSE_TEXT_SCALE}
            style={[styles.label, styles.zone, { color: zoneColour(zone, isDark, 'text') }]}
          >
            {`Z${zone}`}
          </FitText>
        ) : null}
      </View>
    </PressTarget>
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
  const width = useTextScaleColumns(GRID_COLUMNS) === 1 ? '100%' : '50%';

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
            emptyKind={emptyKind}
            changeFieldLabel={t('recording.changeField')}
            isDark={isDark}
            textColor={themeColors.text}
            mutedColor={themeColors.textSecondary}
            width={width}
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
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: stroke.hairline,
  },
  value: {
    ...typography.statsValueLarge,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    maxWidth: '100%',
    marginTop: spacing.xxs,
  },
  label: {
    ...typography.caption,
    flexShrink: 1,
  },
  zone: {
    flexShrink: 0,
    fontWeight: typography.captionBold.fontWeight,
    marginLeft: spacing.xs,
  },
});
