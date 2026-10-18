import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '@/shared/app';
import { Text } from 'react-native-paper';
import { RangeCoverage } from 'veloqrs';

import { DENSE_TEXT_SCALE } from '@/shared/ui/DenseText';
import { useTranslation } from 'react-i18next';
import { typography, spacing, chartStyles, themedStyles, type Palette } from '@/theme';
import { formatMonth, formatShortDate } from '@/shared/format/format';
import { spokenVerdict } from '@/shared/format/spoken';
import { trendVerdict, verdictRung, type TrendDirection } from '@/shared/format/trend';
import {
  ChartCanvas,
  ChartDot,
  chartStroke,
  ChartSurface,
  CurveLine,
  niceScale,
  seriesSummary,
  seriesTable,
  useChartColors,
  YAxisLabels,
  type SummarySeries,
} from '@/shared/charts';
import { EmptyState } from '@/shared/ui/EmptyState';
import { Badge, verdictTone } from '@/shared/ui/Badge';
import { formatSignedPercentage } from '@/shared/format';

/** One daily eFTP estimate: the local day and the watts. */
interface FtpSeriesPoint {
  date: string;
  eftp: number;
}

interface FTPTrendChartProps {
  /** The engine's daily eFTP series, oldest first */
  data?: FtpSeriesPoint[] | undefined;
  /** The engine's step in watts over the window the caption names, with its sign */
  change?: number | undefined;
  /** The step as a percentage of the earlier estimate */
  changePercent?: number | undefined;
  /** The window in days the engine measured the step over, which the caption names */
  lookbackDays?: number | undefined;
  /** Chart height */
  height?: number | undefined;
  /**
   * Whether the wellness the series is read from was downloaded for the days
   * the chart draws. `NotFetched` turns the empty state into "not downloaded".
   * Absent, the chart claims nothing either way.
   */
  coverage?: RangeCoverage | undefined;
}

interface FtpPoint {
  x: number;
  y: number;
  date: string;
}

// Half a label line above the top tick, and a label line under the plot for the dates.
const CHART_PADDING = {
  top: typography.caption.lineHeight / 2,
  bottom: typography.caption.lineHeight,
} as const;
/** Steps the watts axis is cut into, so the gutter carries three or four round values. */
const Y_INTERVALS = 2;
const SERIES = { y: (d: FtpPoint) => d.y };
const xOf = (d: FtpPoint) => d.x;

export function FTPTrendChart({
  data,
  change: ftpChange = 0,
  changePercent = 0,
  lookbackDays,
  height = 180,
  coverage,
}: FTPTrendChartProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const styles = themedStyles(makeStyles, isDark);
  const chartColors = useChartColors();

  // All hooks must be called before any conditional returns
  const chartData = useMemo<FtpPoint[]>(() => {
    if (!data || data.length === 0) return [];
    return data.map((d, idx) => ({
      x: idx,
      y: d.eftp,
      date: d.date,
    }));
  }, [data]);

  const { minFTP, maxFTP, latestFTP } = useMemo(() => {
    if (chartData.length === 0) {
      return {
        minFTP: 200,
        maxFTP: 300,
        latestFTP: 0,
      };
    }

    const values = chartData.map((d) => d.y);

    return {
      minFTP: Math.min(...values) - 10,
      maxFTP: Math.max(...values) + 10,
      latestFTP: values[values.length - 1],
    };
  }, [chartData]);

  const direction: TrendDirection = ftpChange > 0 ? 'up' : ftpChange < 0 ? 'down' : 'flat';
  const verdict = trendVerdict('ftp', direction);
  const rung = verdictRung(verdict);
  const arrow = ftpChange > 0 ? '▲ ' : ftpChange < 0 ? '▼ ' : '';
  // The triangle is read as "black up-pointing triangle", so the badge is
  // named with the judgement it draws instead.
  const changeLabel = `${spokenVerdict(verdict, direction)}, ${Math.abs(ftpChange)} ${t('units.watts')}`;
  const yScale = useMemo(() => niceScale([minFTP, maxFTP], Y_INTERVALS), [minFTP, maxFTP]);
  const yDomain = yScale.domain;
  const yTicks = useMemo(() => {
    const watts = t('units.watts');
    const top = yScale.ticks.length - 1;
    // The unit is printed once, on the top label.
    return yScale.ticks.map((value, i) => ({
      value,
      label: i === top ? `${value} ${watts}` : String(value),
    }));
  }, [yScale, t]);
  const reading = useMemo(() => {
    const watts = t('units.watts');
    const series: SummarySeries = {
      name: t('stats.estimatedFtp'),
      unit: watts,
      points: chartData.map((d) => ({ label: formatShortDate(d.date), key: d.date, value: d.y })),
      format: (v) => `${Math.round(v)} ${watts}`,
    };
    return {
      summary: seriesSummary(series, t),
      table: seriesTable(series.name, t('charts.column.date'), [series]),
    };
  }, [chartData, t]);

  // Show empty state if no data
  if (!data || data.length === 0) {
    const notDownloaded = coverage === RangeCoverage.NotFetched;
    return (
      <View style={[styles.container, { height }]}>
        <View style={styles.emptyState}>
          {notDownloaded ? (
            <EmptyState
              variant="inline"
              testID="ftp-trend-not-downloaded"
              title={t('stats.rangeNotDownloaded')}
            />
          ) : (
            <EmptyState
              variant="inline"
              title={t('stats.noFtpData')}
              description={t('stats.completePowerActivities')}
            />
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { height }]}>
      {/* Header with current FTP */}
      <View style={styles.header}>
        <View>
          <Text style={styles.label}>{t('stats.estimatedFtp')}</Text>
          <View style={styles.ftpRow}>
            <Text style={styles.ftpValue}>
              {latestFTP} {t('units.watts')}
            </Text>
            <Badge
              tone={verdictTone(rung)}
              text={`${arrow}${Math.abs(ftpChange)} ${t('units.watts')}`}
              label={changeLabel}
              isDark={isDark}
            />
          </View>
          {lookbackDays ? (
            <Text style={styles.changeSubtext}>
              {formatSignedPercentage(changePercent, 1)}{' '}
              {t('stats.fromDaysAgo', { count: lookbackDays })}
            </Text>
          ) : null}
        </View>
      </View>

      {/* Chart */}
      <ChartSurface summary={reading.summary} table={reading.table}>
        <View style={styles.plotRow}>
          <YAxisLabels
            ticks={yTicks}
            domain={yDomain}
            padding={CHART_PADDING}
            testID="ftp-trend-y-axis"
          />
          <View style={chartStyles.chartWrapper}>
            <ChartCanvas
              data={chartData}
              x={xOf}
              series={SERIES}
              yDomain={yDomain}
              padding={CHART_PADDING}
              gridValues={yScale.ticks}
            >
              {({ points }) => {
                const last = points.y[points.y.length - 1];
                return (
                  <>
                    <CurveLine
                      points={points.y}
                      color={chartColors.casing}
                      strokeWidth={chartStroke.casing}
                    />
                    <CurveLine points={points.y} color={chartColors.ftp} />
                    {last ? <ChartDot x={last.x} y={last.y} color={chartColors.ftp} /> : null}
                  </>
                );
              }}
            </ChartCanvas>

            {/* X-axis labels */}
            <View style={styles.xAxisOverlay} pointerEvents="none">
              {chartData.length > 0 && (
                <>
                  <Text
                    maxFontSizeMultiplier={DENSE_TEXT_SCALE}
                    style={[chartStyles.chartLabel, isDark && chartStyles.chartLabelDark]}
                  >
                    {formatMonth(chartData[0].date)}
                  </Text>
                  <Text
                    maxFontSizeMultiplier={DENSE_TEXT_SCALE}
                    style={[chartStyles.chartLabel, isDark && chartStyles.chartLabelDark]}
                  >
                    {formatMonth(chartData[chartData.length - 1].date)}
                  </Text>
                </>
              )}
            </View>
          </View>
        </View>
      </ChartSurface>
    </View>
  );
}

const makeStyles = (palette: Palette) =>
  StyleSheet.create({
    container: {},
    header: {
      marginBottom: spacing.sm,
    },
    label: {
      ...typography.caption,
      color: palette.textSecondary,
    },
    ftpRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    ftpValue: {
      ...typography.headlineNumber,
      color: palette.textPrimary,
    },
    changeSubtext: {
      ...typography.caption,
      color: palette.textSecondary,
      marginTop: spacing.xxs,
    },
    plotRow: {
      flex: 1,
      flexDirection: 'row',
    },
    xAxisOverlay: {
      position: 'absolute',
      bottom: 0,
      left: spacing.xs,
      right: spacing.xs,
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    emptyState: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
