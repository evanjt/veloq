import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { useTheme } from '@/shared/app';
import { CurveChart } from '@/shared/charts';
import { CardHeader } from '@/shared/ui/CardHeader';
import { formatShortDate } from '@/shared/format/format';
import { colors, darkColors, spacing, typography } from '@/theme';
import { seriesChartModel, type SeriesDatum, type SeriesSample } from '../lib/seriesChart';

const CHART_HEIGHT = 140;

interface InsightSeriesChartProps {
  samples: readonly SeriesSample[];
  /** Names the series, and so the value axis. */
  title: string;
  color: string;
  /**
   * Prints a value with its unit, on the ticks and in the readout. `decimals`
   * is what tells neighbouring values apart over this series' range.
   */
  formatValue: (value: number, decimals: number) => string;
  /** Draw the lowest value at the top, for a time where lower is better. */
  invert?: boolean;
  /** A dot on every sample, for a series of discrete efforts. */
  pointColor?: string;
  /** A ringed dot on the sample at this index in `samples`. */
  marker?: { index: number; color: string } | null;
  /** Shown at the title's trailing edge, such as a glyph for the series' verdict. */
  accessory?: React.ReactNode;
}

const formatDate = (epochSeconds: number) => formatShortDate(new Date(epochSeconds * 1000));

/**
 * An insight's history on the shared scrubbable chart: the series name, value
 * ticks in the series' unit, date ticks, and a readout of the newest sample
 * until a scrub picks another.
 */
export const InsightSeriesChart = React.memo(function InsightSeriesChart({
  samples,
  title,
  color,
  formatValue,
  invert = false,
  pointColor,
  marker,
  accessory,
}: InsightSeriesChartProps) {
  const { isDark } = useTheme();
  const [selected, setSelected] = useState<SeriesDatum | null>(null);

  const model = useMemo(() => seriesChartModel(samples, { formatDate, invert }), [samples, invert]);
  const decimals = model?.decimals ?? 0;
  const formatY = useCallback(
    (value: number) => formatValue(value, decimals),
    [formatValue, decimals]
  );
  const onInteractionChange = useCallback((active: boolean) => {
    if (!active) setSelected(null);
  }, []);

  const markerAt = useMemo(() => {
    if (!marker || !model) return null;
    const at = model.data.findIndex((d) => d.index === marker.index);
    return at >= 0 ? { index: at, color: marker.color } : null;
  }, [marker, model]);

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
                {formatValue(shown.value, decimals)}
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
          xDomain={model.xDomain}
          yDomain={model.yDomain}
          xLabels={model.xLabels}
          formatY={formatY}
          color={color}
          curve="linear"
          area
          marker={markerAt}
          {...(pointColor !== undefined && { pointColor })}
          referenceLine={null}
          onSelect={setSelected}
          onInteractionChange={onInteractionChange}
        />
      </View>
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
    fontSize: typography.bodyCompact.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  readoutDate: {
    fontSize: typography.micro.fontSize,
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
});
