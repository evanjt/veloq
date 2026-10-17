import React, { useRef, useCallback } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { DenseText } from '@/shared/ui/DenseText';
import { useTheme } from '@/shared/app';
import {
  chipFrame,
  composeAccessibilityLabel,
  pressable,
  pressRipple,
  selectedChipPaint,
} from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import * as haptics from '@/shared/ui/haptics';
import { useTranslation } from 'react-i18next';
import {
  chartStreamColour,
  colors,
  colorWithOpacity,
  darkColors,
  iconSize,
  layout,
  slopToMinTapTarget,
  spacing,
  stroke,
  typography,
  opacity,
} from '@/theme';
import { isolateNumeric } from '@/shared/format';
import { chartTypeLabel, type ChartConfig } from '@/features/activity/lib/chartConfig';
import { PREVIEW_HOLD_MS } from '@/shared/ui/holdDurations';

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
        // Selected, the chip is the app's selected chip, whose ink clears 4.5:1
        // on its fill where a stream hue under any one ink does not. Unselected,
        // the stream's tint is the ground under the primary text. The dot says
        // which stream it is in both states.
        const frame = chipFrame(
          isSelected,
          isDark,
          colorWithOpacity(
            chartStreamColour(config.stream, isDark),
            isDark ? opacity.tint4 : opacity.tint2
          )
        );
        const textColor = isSelected
          ? selectedChipPaint(isDark).ink
          : isDark
            ? darkColors.textPrimary
            : colors.textPrimary;
        const label = chartTypeLabel(config, t);
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
            style={pressable([styles.chip, metric && styles.chipWithValue, frame])}
            android_ripple={pressRipple}
            hitSlop={metric ? CHIP_WITH_VALUE_SLOP : CHIP_SLOP}
            onPressIn={handlePressIn}
            onPress={() => handlePress(config.id)}
            onLongPress={() => handleLongPress(config.id)}
            onPressOut={handlePressOut}
            delayLongPress={PREVIEW_HOLD_MS}
          >
            <View style={styles.chipLabelRow}>
              <View
                testID={`chart-type-${config.id}-mark`}
                style={[
                  styles.chipMark,
                  { backgroundColor: chartStreamColour(config.stream, isDark) },
                ]}
              />
              <Icon name={config.icon} size={iconSize.xs} color={textColor} />
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
const CHIP_HEIGHT = typography.label.lineHeight + 2 * spacing.xs + 2 * stroke.one;
const CHIP_WITH_VALUE_HEIGHT = CHIP_HEIGHT + spacing.xxs + typography.badge.lineHeight;
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
  // The data-mark size, so the chip keys its stream as a legend does.
  chipMark: {
    width: spacing.sm,
    height: spacing.sm,
    borderRadius: layout.borderRadiusXs,
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
    ...typography.badge,
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
