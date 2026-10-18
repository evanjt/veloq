import React from 'react';
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
import { useTranslation } from 'react-i18next';
import {
  chartStreamColour,
  colors,
  darkColors,
  iconSize,
  layout,
  slopToMinTapTarget,
  spacing,
  stroke,
  typography,
} from '@/theme';
import { isolateNumeric } from '@/shared/format';
import { chartTypeLabel, type ChartConfig } from '@/features/activity/lib/chartConfig';

interface ChartMetricDisplay {
  id: string;
  value: string;
  unit: string;
  /** Longest formatted value for stable width */
  maxValueWidth?: string | undefined;
  /** The value is the activity's average, drawn with a mark saying so */
  isAverage?: boolean | undefined;
  /** The value is the climb's gain, drawn with a mark saying so */
  isGain?: boolean | undefined;
}

interface ChartTypeSelectorProps {
  /** Available chart types (only those with data) */
  available: ChartConfig[];
  /** Currently selected chart type IDs */
  selected: string[];
  /** Toggle a chart type on/off */
  onToggle: (id: string) => void;
  /** Per-chart metric values to display inside chips (avg or scrub position) */
  metricValues?: ChartMetricDisplay[];
}

/**
 * The activity streams' readout row, which is also their legend: one chip per
 * stream, keyed by a short line in its colour, named in the text colour, with
 * its value and unit. A tap draws or removes its lane.
 */
export function ChartTypeSelector({
  available,
  selected,
  onToggle,
  metricValues,
}: ChartTypeSelectorProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const palette = isDark ? darkColors : colors;

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
        // it is the neutral control ground under the primary text. Chart text
        // never sits on a stream colour: the line key says which stream it is.
        const frame = chipFrame(isSelected, isDark, palette.fillNeutral);
        const textColor = isSelected ? selectedChipPaint(isDark).ink : palette.textPrimary;
        const label = chartTypeLabel(config, t);
        // Get metric value for this chip
        const metric = metricValues?.find((m) => m.id === config.id);
        // The chip is one element, so its name carries the value it draws.
        const valueWithUnit = metric
          ? metric.unit
            ? `${metric.value} ${metric.unit}`
            : metric.value
          : null;
        // At rest a chip reads the activity's average, or for elevation the
        // climb's gain, and says which; a scrub reads the sample and drops it.
        const isGain = config.defaultMetric === 'gain';
        const resting = metric?.isAverage === true || metric?.isGain === true;
        const restMark = isGain ? t('activity.chartGain') : t('activity.chartAverage');
        const spokenValue =
          resting && valueWithUnit
            ? `${isGain ? t('activity.chartGain') : t('activity.stats.average')} ${valueWithUnit}`
            : valueWithUnit;
        const shownMark = resting ? `${restMark} ` : '';
        // The reserve keeps the mark's room while a scrub hides it, so the chip
        // holds its width.
        const reservedMark = `${restMark} `;

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
            onPress={() => onToggle(config.id)}
          >
            <View style={styles.chipLabelRow}>
              <View
                testID={`chart-type-${config.id}-key`}
                style={[
                  styles.chipKey,
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
                  {shownMark ? (
                    <DenseText testID={`chart-type-${config.id}-${isGain ? 'gain' : 'average'}`}>
                      {shownMark}
                    </DenseText>
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
  // A short stroke of the stream's line, so the chip keys its lane as a legend does.
  chipKey: {
    width: spacing.md,
    height: stroke.two,
    borderRadius: layout.borderRadiusFull,
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
