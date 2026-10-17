import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '@/shared/app';
import { Text } from 'react-native-paper';
import { RangeCoverage } from 'veloqrs';

import { DENSE_TEXT_SCALE } from '@/shared/ui/DenseText';
import { useTranslation } from 'react-i18next';
import { Circle, LinearGradient, vec } from '@shopify/react-native-skia';
import {
  colors,
  typography,
  spacing,
  layout,
  chartStyles,
  darkColors,
  themedStyles,
  verdictColor,
  verdictFill,
  type Palette,
} from '@/theme';
import { formatMonth, formatShortDate } from '@/shared/format/format';
import { spokenVerdict } from '@/shared/format/spoken';
import { trendVerdict, verdictRung, type TrendDirection } from '@/shared/format/trend';
import {
  ChartCanvas,
  ChartSurface,
  CurveArea,
  CurveLine,
  seriesSummary,
  seriesTable,
  useChartColors,
  type SummarySeries,
} from '@/shared/charts';
import { EmptyState } from '@/shared/ui/EmptyState';
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

const CHART_PADDING = { top: 8 } as const;
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
  const yDomain = useMemo<[number, number]>(() => [minFTP, maxFTP], [minFTP, maxFTP]);
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
            <Text
              style={[
                styles.ftpValue,
                { color: isDark ? darkColors.chartFtpText : colors.chartFtpText },
              ]}
            >
              {latestFTP} {t('units.watts')}
            </Text>
            <View style={[styles.changeBadge, { backgroundColor: verdictFill(rung, isDark) }]}>
              <Text
                accessibilityLabel={changeLabel}
                style={[styles.changeText, { color: verdictColor(rung, isDark) }]}
              >
                {arrow}
                {Math.abs(ftpChange)} {t('units.watts')}
              </Text>
            </View>
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
        <View style={chartStyles.chartWrapper}>
          <ChartCanvas
            data={chartData}
            x={xOf}
            series={SERIES}
            yDomain={yDomain}
            padding={CHART_PADDING}
            grid={5}
          >
            {({ points, bounds }) => {
              const last = points.y[points.y.length - 1];
              return (
                <>
                  <CurveArea points={points.y} y0={bounds.bottom}>
                    <LinearGradient
                      start={vec(0, bounds.top)}
                      end={vec(0, bounds.bottom)}
                      colors={[chartColors.ftp + '60', chartColors.ftp + '10']}
                    />
                  </CurveArea>
                  <CurveLine points={points.y} color={chartColors.casing} strokeWidth={2.5} />
                  <CurveLine points={points.y} color={chartColors.ftp} strokeWidth={1.5} />
                  {last ? (
                    <>
                      <Circle cx={last.x} cy={last.y} r={6} color={chartColors.ftp} />
                      <Circle cx={last.x} cy={last.y} r={3} color={colors.textOnDark} />
                    </>
                  ) : null}
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
                  style={[chartStyles.axisLabelCompact, isDark && chartStyles.axisLabelCompactDark]}
                >
                  {formatMonth(chartData[0].date)}
                </Text>
                <Text
                  maxFontSizeMultiplier={DENSE_TEXT_SCALE}
                  style={[chartStyles.axisLabelCompact, isDark && chartStyles.axisLabelCompactDark]}
                >
                  {formatMonth(chartData[chartData.length - 1].date)}
                </Text>
              </>
            )}
          </View>

          {/* Y-axis labels */}
          <View style={styles.yAxisOverlay} pointerEvents="none">
            <Text
              maxFontSizeMultiplier={DENSE_TEXT_SCALE}
              style={[chartStyles.axisLabelCompact, isDark && chartStyles.axisLabelCompactDark]}
            >
              {Math.round(maxFTP)} {t('units.watts')}
            </Text>
            <Text
              maxFontSizeMultiplier={DENSE_TEXT_SCALE}
              style={[chartStyles.axisLabelCompact, isDark && chartStyles.axisLabelCompactDark]}
            >
              {Math.round((minFTP + maxFTP) / 2)} {t('units.watts')}
            </Text>
            <Text
              maxFontSizeMultiplier={DENSE_TEXT_SCALE}
              style={[chartStyles.axisLabelCompact, isDark && chartStyles.axisLabelCompactDark]}
            >
              {Math.round(minFTP)} {t('units.watts')}
            </Text>
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
    },
    changeBadge: {
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xxs,
      borderRadius: layout.borderRadius,
    },
    changeText: {
      ...typography.captionBold,
    },
    changeSubtext: {
      fontSize: typography.label.fontSize,
      color: palette.textSecondary,
      marginTop: spacing.xxs,
    },
    xAxisOverlay: {
      position: 'absolute',
      bottom: 0,
      left: spacing.xs,
      right: spacing.xs,
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    yAxisOverlay: {
      position: 'absolute',
      top: spacing.sm,
      bottom: spacing.md,
      left: spacing.xs,
      justifyContent: 'space-between',
    },
    emptyState: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
