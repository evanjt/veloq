import React, { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { chartStyles, darkColors, colors, typography, spacing } from '@/theme';
import { summarySeriesColor } from '../lib/summaryMetricColour';
import {
  ChartCrosshair,
  dotDisks,
  Sparkline,
  SPARKLINE_RANGE_WIDTH,
  useChartGestures,
  type SparklinePoint,
} from '@/shared/charts';
import { DENSE_TEXT_SCALE, DenseText, denseExtent } from '@/shared/ui/DenseText';
import { FitText } from '@/shared/ui/FitText';
import { SPARKLINE_MIN_DAYS, type ScrubValues } from './SummaryCardSparkline';
import { scrubDateLabel } from '../lib/scrubDateLabel';

/** One row's plot height, which holds its range's high and low on two caption lines. */
export const HRV_ROW_HEIGHT = 2 * typography.caption.lineHeight;
const ROW_GAP = spacing.xs;

/** The rows' height: the HRV row, and the resting heart rate row under it when drawn. */
export function hrvSparklineHeight(withRhr: boolean): number {
  return withRhr ? 2 * HRV_ROW_HEIGHT + ROW_GAP : HRV_ROW_HEIGHT;
}

/** Whether a resting heart rate series is drawn: one reading for every HRV day. */
export function drawsRhr(hrvData: number[], rhrData: number[] | undefined): boolean {
  return rhrData !== undefined && rhrData.length === hrvData.length;
}
/** The row label column holds one short word, "HRV" or "RHR", at the cap. */
const LABEL_WIDTH = denseExtent(typography.caption.fontSize, 3.6);
/** Where the rows' first and last days sit in from the plot's edges, the last day's dot. */
const PLOT_INSET = dotDisks().ring;

interface SummaryCardHRVSparklineProps {
  hrvData: number[];
  rhrData?: number[] | undefined;
  /** Beside each series: whether that day had a reading of its own. */
  hrvRead?: boolean[] | undefined;
  rhrRead?: boolean[] | undefined;
  width: number;
  onScrub?: ((values: ScrubValues | null) => void) | undefined;
  onTap?: (() => void) | undefined;
}

/** A daily series as sparkline points, each labelled with its day. */
function dailyPoints(values: number[]): SparklinePoint[] {
  return values.map((value, i) => ({ value, label: scrubDateLabel(values.length - 1 - i) }));
}

/**
 * HRV and resting heart rate for the SummaryCard, each in its own labelled row
 * on its own scale with its range printed beside it. Neither is inverted: a
 * higher reading draws higher in both. One scrub runs across both rows and
 * updates the hero value through onScrub.
 */
export const SummaryCardHRVSparkline = memo(function SummaryCardHRVSparkline({
  hrvData,
  rhrData,
  hrvRead,
  rhrRead,
  width,
  onScrub,
  onTap,
}: SummaryCardHRVSparklineProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();

  const hrvRef = useRef(hrvData);
  hrvRef.current = hrvData;
  const rhrRef = useRef(rhrData);
  rhrRef.current = rhrData;
  const readRef = useRef({ hrv: hrvRead, rhr: rhrRead });
  readRef.current = { hrv: hrvRead, rhr: rhrRead };
  const onScrubRef = useRef(onScrub);
  onScrubRef.current = onScrub;
  const onTapRef = useRef(onTap);
  onTapRef.current = onTap;

  const rhrSeries = rhrData && drawsRhr(hrvData, rhrData) ? rhrData : null;
  const plotWidth = Math.max(0, width - LABEL_WIDTH - SPARKLINE_RANGE_WIDTH - 2 * spacing.xs);
  const totalHeight = hrvSparklineHeight(rhrSeries !== null);

  const hrvPoints = useMemo(() => dailyPoints(hrvData), [hrvData]);
  const rhrPoints = useMemo(() => (rhrSeries ? dailyPoints(rhrSeries) : null), [rhrSeries]);
  const formatHrv = useCallback((v: number) => `${Math.round(v)} ${t('units.ms')}`, [t]);
  const formatRhr = useCallback((v: number) => `${Math.round(v)} ${t('units.bpm')}`, [t]);

  const notifyScrub = useCallback((_point: number, index: number) => {
    const hrv = hrvRef.current;
    const rhr = rhrRef.current;
    const cb = onScrubRef.current;
    if (!cb || index < 0 || index >= hrv.length) return;
    const dateLabel = scrubDateLabel(hrv.length - 1 - index);
    const read = readRef.current;
    cb({
      fitness: 0,
      fatigue: 0,
      form: 0,
      hrv: read.hrv?.[index] === false ? null : hrv[index],
      rhr: rhr ? (read.rhr?.[index] === false ? null : rhr[index]) : undefined,
      dateLabel,
    });
  }, []);

  const handleInteractionChange = useCallback((active: boolean) => {
    if (!active) onScrubRef.current?.(null);
  }, []);

  const fireTap = useCallback(() => {
    onTapRef.current?.();
  }, []);

  const { gesture, crosshairStyle, syncBounds, scrubIndex } = useChartGestures<number>({
    data: hrvData,
    accessibilityLabel: t('metrics.hrv'),
    scrubEnabled: !!onScrub,
    scrubActivation: 'drag',
    tapMaxDuration: 500,
    onSelect: notifyScrub,
    onInteractionChange: handleInteractionChange,
    onTap: onTap ? fireTap : undefined,
  });

  // The plot starts past the label column, and its first and last days sit in
  // from its edges by the dot, so the scrub maps over the days as drawn.
  const plotLeft = LABEL_WIDTH + spacing.xs;
  useEffect(() => {
    syncBounds({
      left: plotLeft + PLOT_INSET,
      right: plotLeft + plotWidth - PLOT_INSET,
      top: 0,
      bottom: totalHeight,
    });
  }, [syncBounds, plotLeft, plotWidth, totalHeight]);

  if (hrvData.length < SPARKLINE_MIN_DAYS || width <= 0) {
    return <View style={{ width, height: totalHeight }} />;
  }

  const labelStyle = [chartStyles.chartLabelStrong, isDark && chartStyles.chartLabelStrongDark];
  const scrubbed = scrubIndex >= 0 ? scrubIndex : undefined;
  const row = (
    key: 'hrv' | 'rhr',
    points: SparklinePoint[],
    format: (v: number) => string,
    unit: string
  ) => (
    <View style={styles.row}>
      <FitText style={[labelStyle, styles.label]} maxFontSizeMultiplier={DENSE_TEXT_SCALE}>
        {t(`metrics.${key}`)}
      </FitText>
      <Sparkline
        testID={`summary-card-${key}-row`}
        name={t(`metrics.${key}`)}
        unit={unit}
        points={points}
        format={format}
        width={plotWidth}
        height={HRV_ROW_HEIGHT}
        color={summarySeriesColor(key, isDark)}
        scrubIndex={scrubbed}
        showRange
      />
    </View>
  );

  return (
    <GestureDetector gesture={gesture}>
      <View
        style={[styles.container, chartStyles.plotDirection, { width, minHeight: totalHeight }]}
      >
        {row('hrv', hrvPoints, formatHrv, t('units.ms'))}
        {rhrPoints ? row('rhr', rhrPoints, formatRhr, t('units.bpm')) : null}

        {/* Time range label */}
        <DenseText
          style={[
            styles.rangeLabel,
            { color: isDark ? darkColors.textSecondary : colors.textSecondary },
          ]}
        >
          {t('units.daysShort', { days: hrvData.length })}
        </DenseText>

        <ChartCrosshair style={crosshairStyle} topOffset={0} bottomOffset={0} />
      </View>
    </GestureDetector>
  );
});

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    gap: ROW_GAP,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  label: {
    width: LABEL_WIDTH,
  },
  rangeLabel: {
    ...typography.caption,
    position: 'absolute',
    bottom: '100%',
    right: 2,
  },
});
