import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { CurveChart, type FurtherSeries } from '@/shared/charts';
import { CardHeader } from '@/shared/ui/CardHeader';
import type { AccessibleAction } from '@/shared/ui/accessibleActions';
import { formatShortDate } from '@/shared/format/format';
import { chartStyles, colors, darkColors, layout, spacing, typography } from '@/theme';
import { seriesChartModel, type SeriesDatum, type SeriesSample } from '../lib/seriesChart';

const CHART_HEIGHT = 140;

/** A series drawn beside the first, such as a week's second total. */
export interface InsightFurtherSeries {
  label: string;
  samples: readonly SeriesSample[];
  color: string;
}

interface InsightSeriesChartProps {
  samples: readonly SeriesSample[];
  /** Names the series, and so the value axis. */
  title: string;
  color: string;
  /**
   * Series drawn beside the first, read at the same positions in their
   * arrays. With any, a key names each series by its label, the first by
   * `label`.
   */
  others?: readonly InsightFurtherSeries[];
  /** The first series' name in the key, when there are others. Defaults to `title`. */
  label?: string;
  /**
   * Prints a value with its unit, on the ticks and in the readout. `decimals`
   * is what tells neighbouring values apart over this series' range.
   */
  formatValue: (value: number, decimals: number) => string;
  /**
   * Draw the lowest value at the top, for a time where lower is better. A
   * caption under the plot says so; an upright chart needs none, as its
   * ticks already say up is more.
   */
  invert?: boolean;
  /** A dot on every sample, for a series of discrete efforts. */
  pointColor?: string;
  /** The record's gold ring or the reticle on the sample at this index in `samples`. */
  marker?: { index: number; kind: 'record' | 'this' } | null;
  /** Shown at the title's trailing edge, such as a glyph for the series' verdict. */
  accessory?: React.ReactNode;
  /** One bar per sample from zero, for totals over a period. */
  bars?: boolean;
  /** The window the claim was read over, shaded behind the series, in epoch seconds. */
  band?: { from: number; to: number } | undefined;
  /** Fills under the line. Off for a bare line over a domain that excludes zero. */
  area?: boolean;
  /** What the chart offers a screen reader beside stepping its samples. */
  actions?: readonly AccessibleAction[];
  /** The dates the axis spans at least, so charts stacked over one time axis line up. */
  xRange?: { from: number; to: number } | undefined;
}

const formatDate = (epochSeconds: number) => formatShortDate(new Date(epochSeconds * 1000));

const NO_OTHERS: readonly InsightFurtherSeries[] = [];

/**
 * An insight's history on the shared scrubbable chart: the series name, value
 * ticks in the series' unit, date ticks, and a readout of the newest sample
 * until a scrub picks another.
 */
export const InsightSeriesChart = React.memo(function InsightSeriesChart({
  samples,
  title,
  color,
  others = NO_OTHERS,
  label,
  formatValue,
  invert = false,
  pointColor,
  marker,
  accessory,
  bars = false,
  band,
  area = true,
  actions,
  xRange,
}: InsightSeriesChartProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const [selected, setSelected] = useState<SeriesDatum | null>(null);

  const otherSamples = useMemo(() => others.map((other) => other.samples), [others]);
  const model = useMemo(
    () =>
      seriesChartModel(samples, {
        formatDate,
        invert,
        fromZero: bars,
        others: otherSamples,
        xRange,
      }),
    [samples, invert, bars, otherSamples, xRange]
  );
  const further = useMemo<FurtherSeries<SeriesDatum>[]>(
    () => others.map((other, i) => ({ y: (d: SeriesDatum) => d.others[i], color: other.color })),
    [others]
  );
  const decimals = model?.decimals ?? 0;
  const formatY = useCallback(
    (value: number) => formatValue(value, decimals),
    [formatValue, decimals]
  );
  // An undated series is placed by its order, so its rows are numbered rather than dated.
  const dated = model?.data[0]?.date != null;
  const reading = useMemo(
    () => ({
      title,
      xHeader: dated ? t('charts.column.date') : '#',
      formatX: dated ? formatDate : (x: number) => String(x + 1),
      lowerIsBetter: invert,
      shape: 'series' as const,
    }),
    [title, dated, invert, t]
  );
  const onInteractionChange = useCallback((active: boolean) => {
    if (!active) setSelected(null);
  }, []);

  const markerAt = useMemo(() => {
    if (!marker || !model) return null;
    const at = model.data.findIndex((d) => d.index === marker.index);
    return at >= 0 ? { index: at, kind: marker.kind } : null;
  }, [marker, model]);

  // An undated series is placed by its order, so a window of dates has nowhere to go.
  const shaded = band && dated ? band : null;

  const shown = selected ?? model?.data.at(-1);
  if (!model || !shown) return null;

  return (
    <View>
      <CardHeader
        title={title}
        accessory={
          <View style={styles.trailing}>
            {accessory}
            <View style={styles.readout}>
              <Text
                testID="insight-series-readout-value"
                style={[styles.readoutValue, isDark && styles.primaryDark]}
              >
                {[shown.value, ...shown.others]
                  .map((value) => (value == null ? '–' : formatValue(value, decimals)))
                  .join(' · ')}
              </Text>
              {shown.date != null ? (
                <Text
                  testID="insight-series-readout-date"
                  style={[styles.readoutDate, isDark && styles.secondaryDark]}
                >
                  {formatDate(shown.date)}
                </Text>
              ) : null}
            </View>
          </View>
        }
      />
      <View style={styles.chart}>
        <CurveChart
          testID="insight-series-chart"
          topAxisTestID="insight-series-axis-top"
          data={model.data}
          others={further}
          xDomain={model.xDomain}
          yDomain={model.yDomain}
          xLabels={model.xLabels}
          formatY={formatY}
          reading={reading}
          color={color}
          curve="linear"
          area={area}
          bars={bars}
          marker={markerAt}
          band={shaded}
          {...(pointColor !== undefined && { pointColor })}
          referenceLine={null}
          describePoint={(d) => {
            const values =
              others.length > 0
                ? [
                    `${label ?? title} ${formatValue(d.value, decimals)}`,
                    ...others.map((other, i) => {
                      const value = d.others[i];
                      return value == null
                        ? null
                        : `${other.label} ${formatValue(value, decimals)}`;
                    }),
                  ]
                    .filter((part) => part !== null)
                    .join(', ')
                : formatValue(d.value, decimals);
            return d.date != null ? `${formatDate(d.date)}, ${values}` : values;
          }}
          onSelect={setSelected}
          onInteractionChange={onInteractionChange}
          {...(actions ? { actions } : {})}
        />
      </View>
      {invert ? (
        <Text
          testID="insight-series-caption"
          style={[chartStyles.chartLabel, isDark && chartStyles.chartLabelDark]}
        >
          {t('charts.fasterIsUp')}
        </Text>
      ) : null}
      {others.length > 0 ? (
        <View testID="insight-series-key" style={styles.key}>
          {[{ label: label ?? title, color }, ...others].map((entry) => (
            <View key={entry.label} style={styles.keyEntry}>
              <View style={[styles.keySwatch, { backgroundColor: entry.color }]} />
              <Text style={[chartStyles.chartLabel, isDark && chartStyles.chartLabelDark]}>
                {entry.label}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  trailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  readout: {
    alignItems: 'flex-end',
  },
  readoutValue: {
    ...typography.bodyCompactBold,
    color: colors.textPrimary,
  },
  readoutDate: {
    ...typography.micro,
    color: colors.textSecondary,
  },
  primaryDark: {
    color: darkColors.textPrimary,
  },
  secondaryDark: {
    color: darkColors.textSecondary,
  },
  chart: {
    height: CHART_HEIGHT,
  },
  key: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  keyEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  keySwatch: {
    width: spacing.sm,
    height: spacing.sm,
    borderRadius: layout.borderRadiusFull,
  },
});
