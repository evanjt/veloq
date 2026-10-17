import React, { useRef, useCallback } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { DenseText } from '@/shared/ui/DenseText';
import { useTheme } from '@/shared/app';
import { composeAccessibilityLabel, pressable, pressRipple } from '@/shared/ui';
import * as haptics from '@/shared/ui/haptics';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import {
  colors,
  colorWithOpacity,
  darkColors,
  iconSize,
  layout,
  slopToMinTapTarget,
  spacing,
  typography,
} from '@/theme';
import { isolateNumeric } from '@/shared/format';
import { type ChartConfig, type ChartTypeId } from '@/features/activity/lib/chartConfig';
import { PREVIEW_HOLD_MS } from '@/shared/ui/holdDurations';

/** Chart type translation key type */
type ChartTypeKey =
  | 'chartTypes.power'
  | 'chartTypes.hr'
  | 'chartTypes.cad'
  | 'chartTypes.speed'
  | 'chartTypes.pace'
  | 'chartTypes.gap'
  | 'chartTypes.elev'
  | 'chartTypes.grade'
  | 'chartTypes.wbal'
  | 'chartTypes.temp';

/** Map chart IDs to translation keys */
const CHART_LABEL_KEYS: Partial<Record<ChartTypeId, ChartTypeKey>> = {
  power: 'chartTypes.power',
  heartrate: 'chartTypes.hr',
  cadence: 'chartTypes.cad',
  speed: 'chartTypes.speed',
  pace: 'chartTypes.pace',
  gap: 'chartTypes.gap',
  elevation: 'chartTypes.elev',
  grade: 'chartTypes.grade',
  wbal: 'chartTypes.wbal',
  temp: 'chartTypes.temp',
};

interface ChartMetricDisplay {
  id: string;
  value: string;
  unit: string;
  /** Longest formatted value for stable width */
  maxValueWidth?: string | undefined;
  /** The value is the activity's average, drawn with a mark saying so */
  isAverage?: boolean | undefined;
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
      haptics.light();
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
        const bgColor = isSelected
          ? config.color
          : colorWithOpacity(config.color, isDark ? 0.25 : 0.15);
        // Unselected read as the stream's own hue, `chartYellow` at 1.50:1 on
        // its own 15% tint. The chip keeps the hue as its ground and its dot, and
        // the label says which stream it is.
        const textColor = isSelected
          ? config.ink
          : isDark
            ? darkColors.textPrimary
            : colors.textPrimary;
        // Use translated label if available, fallback to config.label
        const labelKey = CHART_LABEL_KEYS[config.id];
        const label = labelKey ? (t(labelKey) as string) : config.label;
        // Get metric value for this chip
        const metric = metricValues?.find((m) => m.id === config.id);
        // The chip is one element, so its name carries the value it draws.
        const valueWithUnit = metric
          ? metric.unit
            ? `${metric.value} ${metric.unit}`
            : metric.value
          : null;
        const spokenValue =
          metric?.isAverage && valueWithUnit
            ? `${t('activity.stats.average')} ${valueWithUnit}`
            : valueWithUnit;
        const averageMark = metric?.isAverage ? `${t('activity.chartAverage')} ` : '';
        // The reserve keeps the mark's room while a scrub hides it, so the chip
        // holds its width. The climb chip is a total and never carries one.
        const reservedMark =
          config.defaultMetric === 'gain' ? '' : `${t('activity.chartAverage')} `;

        return (
          <Pressable
            key={config.id}
            testID={`chart-type-${config.id}`}
            accessibilityRole="button"
            accessibilityLabel={composeAccessibilityLabel(label, spokenValue)}
            accessibilityState={{ selected: isSelected }}
            style={pressable([
              styles.chip,
              metric && styles.chipWithValue,
              { backgroundColor: bgColor },
            ])}
            android_ripple={pressRipple}
            hitSlop={metric ? CHIP_WITH_VALUE_SLOP : CHIP_SLOP}
            onPressIn={handlePressIn}
            onPress={() => handlePress(config.id)}
            onLongPress={() => handleLongPress(config.id)}
            onPressOut={handlePressOut}
            delayLongPress={PREVIEW_HOLD_MS}
          >
            <View style={styles.chipLabelRow}>
              <MaterialCommunityIcons name={config.icon} size={iconSize.xs} color={textColor} />
              <DenseText style={[styles.chipLabel, { color: textColor }]}>{label}</DenseText>
            </View>
            {metric ? (
              <View style={styles.chipValueContainer}>
                {/* Hidden max-width text to reserve stable chip width */}
                <DenseText style={[styles.chipValue, styles.chipValueHidden]} numberOfLines={1}>
                  {reservedMark}
                  {isolateNumeric(metric.maxValueWidth || metric.value)}
                  {metric.unit ? ` ${metric.unit}` : ''}
                </DenseText>
                {/* Visible value centered on top */}
                <DenseText
                  style={[styles.chipValue, styles.chipValueVisible, { color: textColor }]}
                  numberOfLines={1}
                >
                  {averageMark ? (
                    <DenseText testID={`chart-type-${config.id}-average`}>{averageMark}</DenseText>
                  ) : null}
                  {isolateNumeric(metric.value)}
                  {metric.unit ? ` ${metric.unit}` : ''}
                </DenseText>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

// The chips wrap into rows only a small gap apart, so each is drawn at its
// content's height and reaches the tap target through slop.
const CHIP_HEIGHT = typography.label.lineHeight + 2 * spacing.xs;
const CHIP_WITH_VALUE_HEIGHT = CHIP_HEIGHT + spacing.xxs + typography.micro.lineHeight;
const CHIP_SLOP = slopToMinTapTarget(CHIP_HEIGHT);
const CHIP_WITH_VALUE_SLOP = slopToMinTapTarget(CHIP_WITH_VALUE_HEIGHT);

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'stretch',
    gap: spacing.xsPlus,
  },
  chip: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    minHeight: CHIP_HEIGHT,
    borderRadius: layout.borderRadius,
  },
  chipWithValue: {
    minHeight: CHIP_WITH_VALUE_HEIGHT,
  },
  chipLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  chipLabel: {
    ...typography.badge,
    lineHeight: typography.label.lineHeight,
  },
  chipValueContainer: {
    alignSelf: 'stretch',
    alignItems: 'center',
    marginTop: spacing.xxs,
  },
  chipValue: {
    fontSize: typography.micro.fontSize,
    lineHeight: typography.micro.lineHeight,
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
