/**
 * The section and route performance chart: one plot at a time, switched
 * between the attempt scatter and the histogram of the engine's bins. The
 * panel owns the shown direction so both plots draw the same one.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Card, DirectionSwitch, ToggleButtonRow } from '@/shared/ui';
import { spacing } from '@/theme';
import { directionColour } from '@/features/routes/lib/directionColour';
import { pickEmphasisedLap, type SectionDeltaLine } from '@/features/routes/lib/deltaLayout';
import {
  resolveChartDirection,
  splitAndPositionChartData,
  type ChartDirection,
} from '@/features/routes/lib/scatterData';
import type { FfiAttemptHistograms, FfiSectionLapCurves } from 'veloqrs';
import { AttemptHistogramChart } from './AttemptHistogramChart';
import { ScatterLegend } from './ScatterLegend';
import { SectionDeltaChart } from './SectionDeltaChart';
import { SectionDeltaSummaryChart } from './SectionDeltaSummaryChart';
import { SectionScatterChart, type SectionScatterChartProps } from './SectionScatterChart';

/** The plots the panel can show. A further plot is one more member and one more branch below. */
export type PerformancePlotType = 'scatter' | 'histogram' | 'delta';

const PLOT_LABEL_KEYS = {
  scatter: 'sections.plotScatter',
  histogram: 'sections.plotHistogram',
  delta: 'sections.plotDelta',
} as const;

const NO_HISTOGRAMS: FfiAttemptHistograms = {};

export interface PerformanceChartPanelProps extends Omit<
  SectionScatterChartProps,
  'selectedDirection' | 'compact' | 'mini' | 'containerStyle'
> {
  /** The engine's attempt-time bins per direction. */
  histograms?: FfiAttemptHistograms | undefined;
  /** The engine's lap delta curves. Absent where the screen has none, which offers no delta plot. */
  curves?: FfiSectionLapCurves | undefined;
  /**
   * Called with what the delta plot shows per split while that plot is shown,
   * the chosen attempt or else the typical one, and with null otherwise, so the
   * section map can colour its line by it.
   */
  onDeltaLineChange?: ((line: SectionDeltaLine | null) => void) | undefined;
}

export function PerformanceChartPanel({
  histograms = NO_HISTOGRAMS,
  curves,
  onDeltaLineChange,
  ...scatterProps
}: PerformanceChartPanelProps) {
  const {
    chartData,
    isDark,
    activityType,
    useTimeAxis,
    highlightedActivityId,
    bestForwardRecord,
    bestReverseRecord,
    bestForwardIsRecord,
    bestReverseIsRecord,
    forwardStats,
    reverseStats,
    onActivitySelect,
  } = scatterProps;
  const { t } = useTranslation();
  const [plotType, setPlotType] = useState<PerformancePlotType>('scatter');
  const [requestedDirection, setRequestedDirection] = useState<ChartDirection | null>(null);

  const { allPoints, domains } = useMemo(() => splitAndPositionChartData(chartData), [chartData]);
  const hasForward = domains.forward !== null;
  const hasReverse = domains.reverse !== null;
  const linkedDirection =
    allPoints.find((point) => point.activityId === highlightedActivityId)?.direction === 'reverse'
      ? 'reverse'
      : 'forward';
  const direction = resolveChartDirection(
    requestedDirection,
    linkedDirection,
    hasForward,
    hasReverse
  );
  const histogram = histograms[direction];
  const trend =
    direction === 'reverse'
      ? useTimeAxis
        ? scatterProps.trendCurves.reverseTime
        : scatterProps.trendCurves.reverseSpeed
      : useTimeAxis
        ? scatterProps.trendCurves.forwardTime
        : scatterProps.trendCurves.forwardSpeed;

  const deltas = curves?.[direction];
  // With an attempt chosen the plot draws its curve; with none it draws the
  // typical attempt, which the engine gives only once enough laps exist.
  const attemptChosen = highlightedActivityId !== undefined;
  const typical = attemptChosen ? undefined : deltas?.splitSummary;

  // A plot whose data has gone stops being shown, and does not return on its
  // own when the data does.
  const available: PerformancePlotType[] = ['scatter'];
  if (histogram) available.push('histogram');
  if (deltas && (attemptChosen || typical)) available.push('delta');
  if (!available.includes(plotType)) setPlotType('scatter');
  const shownPlot: PerformancePlotType = available.includes(plotType) ? plotType : 'scatter';

  const highlightedTime = allPoints.find(
    (point) =>
      point.activityId === highlightedActivityId &&
      (point.direction === 'reverse' ? 'reverse' : 'forward') === direction
  )?.sectionTime;
  const recordTime = (direction === 'reverse' ? bestReverseRecord : bestForwardRecord)?.bestTime;
  const recordHeld = direction === 'reverse' ? bestReverseIsRecord : bestForwardIsRecord;

  const deltaSplits =
    shownPlot !== 'delta' || !deltas
      ? undefined
      : typical
        ? typical.medianSecs
        : pickEmphasisedLap(deltas.laps, highlightedActivityId)?.splitDeltaSecs;
  const deltaSplitStepM = curves?.splitStepM;
  const deltaSectionLengthM = curves?.sectionLengthM;
  useEffect(() => {
    if (!onDeltaLineChange) return;
    onDeltaLineChange(
      deltaSplits && deltaSplitStepM !== undefined && deltaSectionLengthM !== undefined
        ? {
            splits: deltaSplits,
            splitStepM: deltaSplitStepM,
            sectionLengthM: deltaSectionLengthM,
            direction,
          }
        : null
    );
  }, [onDeltaLineChange, deltaSplits, deltaSplitStepM, deltaSectionLengthM, direction]);
  // The map keeps no line of its own once the chart is gone.
  useEffect(() => () => onDeltaLineChange?.(null), [onDeltaLineChange]);

  return (
    <View testID="performance-chart-panel">
      {available.length > 1 && (
        <ToggleButtonRow
          layout="hug"
          style={styles.control}
          options={available.map((type) => ({
            value: type,
            label: t(PLOT_LABEL_KEYS[type]),
            testID: `chart-plot-${type}`,
          }))}
          value={shownPlot}
          onValueChange={setPlotType}
        />
      )}
      {hasForward && hasReverse ? (
        <DirectionSwitch
          testID="section-chart-direction"
          style={styles.control}
          value={direction}
          counts={{ forward: forwardStats?.count ?? 0, reverse: reverseStats?.count ?? 0 }}
          marks={{
            forward: directionColour('forward', isDark),
            reverse: directionColour('reverse', isDark),
          }}
          onChange={(value) => {
            setRequestedDirection(value);
            onActivitySelect?.(null);
          }}
        />
      ) : null}
      {shownPlot === 'delta' && deltas && curves && typical ? (
        <Card variant="flat" padding="none">
          <SectionDeltaSummaryChart
            summary={typical}
            referenceSource={deltas.referenceSource}
            splitStepM={curves.splitStepM}
            sectionLengthM={curves.sectionLengthM}
            isDark={isDark}
          />
        </Card>
      ) : shownPlot === 'delta' && deltas && curves ? (
        <Card variant="flat" padding="none">
          <SectionDeltaChart
            deltas={deltas}
            gridStepM={curves.gridStepM}
            sectionLengthM={curves.sectionLengthM}
            isDark={isDark}
            highlightedActivityId={highlightedActivityId}
          />
        </Card>
      ) : shownPlot === 'histogram' && histogram ? (
        <Card variant="flat" padding="none">
          <AttemptHistogramChart
            histogram={histogram}
            activityType={activityType}
            isDark={isDark}
            useTimeAxis={useTimeAxis}
            highlightedTime={highlightedTime}
            recordTime={recordTime}
            recordHeld={recordHeld}
          />
        </Card>
      ) : (
        <>
          <Card variant="flat" padding="none">
            <SectionScatterChart {...scatterProps} selectedDirection={direction} />
          </Card>
          <ScatterLegend
            isDark={isDark}
            showTrend={!!trend && trend.length >= 2}
            trendColor={directionColour(direction, isDark)}
            showReverse={!!bestReverseRecord}
            showThisActivity={!!highlightedActivityId}
            showOutsideBand={chartData.some((d) => d.outsideDistanceBand === true)}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  control: {
    alignSelf: 'center',
    marginBottom: spacing.xs,
  },
});
