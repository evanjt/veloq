/**
 * The section and route performance panel: one view at a time, named by the
 * question it answers (Over time, Spread, Ahead or behind), over one fixed
 * direction row, then the plot, its legend and the selected attempt's card.
 *
 * The panel owns the shown direction so every view draws the same one, the
 * selected attempt so the card under the chart describes it and the delta
 * view emphasises it, and "Compare with" so the map line is measured against
 * the reference the chart shows.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Card, DirectionSwitch, SelectButton, ToggleButtonRow } from '@/shared/ui';
import { spacing } from '@/theme';
import { directionColour } from '@/features/routes/lib/directionColour';
import {
  deltasAgainst,
  pickEmphasisedLap,
  referenceChoices,
  referenceSplitSecs,
  resolveReference,
  splitPercents,
  type SectionDeltaLine,
} from '@/features/routes/lib/deltaLayout';
import { referenceNameKey } from '@/features/routes/lib/deltaReference';
import {
  resolveChartDirection,
  splitAndPositionChartData,
  type ChartDirection,
  type ScatterChartPoint,
} from '@/features/routes/lib/scatterData';
import {
  availablePlots,
  initialAttempt,
  PLOT_LABEL_KEYS,
  type PerformancePlotType,
} from '@/features/routes/lib/performancePanel';
import { attemptBasis } from '@/features/routes/lib/attemptBasis';
import type { RoutePoint } from '@/types';
import type {
  FfiAttemptHistograms,
  FfiRecordProgressions,
  FfiReferenceSource,
  FfiSectionLapCurves,
} from 'veloqrs';
import { AttemptHistogramChart } from './AttemptHistogramChart';
import { ScatterLegend } from './ScatterLegend';
import { SectionDeltaChart } from './SectionDeltaChart';
import { SectionDeltaSummaryChart } from './SectionDeltaSummaryChart';
import { ExcludedAttemptsLink } from './ExcludedAttemptsLink';
import { SelectedAttemptCard } from './SelectedAttemptCard';
import { SectionScatterChart, type SectionScatterChartProps } from './SectionScatterChart';

export type { PerformancePlotType };

const NO_HISTOGRAMS: FfiAttemptHistograms = {};
const NO_PROGRESSION: FfiRecordProgressions = { forward: [], reverse: [] };

export interface PerformanceChartPanelProps extends Omit<
  SectionScatterChartProps,
  'selectedDirection' | 'selectedPointId' | 'onSelectPoint' | 'showDataRowStart'
> {
  /** Called with the attempt chosen on the plot, and with null when the choice is cleared. */
  onActivitySelect?:
    | ((activityId: string | null, activityPoints?: RoutePoint[], date?: Date) => void)
    | undefined;
  onExcludeActivity?: ((activityId: string) => void) | undefined;
  onIncludeActivity?: ((activityId: string) => void) | undefined;
  onSetAsReference?: ((activityId: string) => void) | undefined;
  referenceActivityId?: string | undefined;
  /** The excluded attempts the engine holds back for the range and sport on screen. */
  excludedCount?: number | undefined;
  showExcluded?: boolean | undefined;
  onToggleShowExcluded?: (() => void) | undefined;
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
  /**
   * Called with the direction on show while both directions are drawn, and
   * with null otherwise, so the section map reads the panel's one direction.
   */
  onShownDirectionChange?: ((direction: ChartDirection | null) => void) | undefined;
}

export function PerformanceChartPanel({
  histograms = NO_HISTOGRAMS,
  curves,
  onDeltaLineChange,
  onShownDirectionChange,
  onActivitySelect,
  onExcludeActivity,
  onIncludeActivity,
  onSetAsReference,
  referenceActivityId,
  excludedCount = 0,
  showExcluded = false,
  onToggleShowExcluded,
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
    recordProgression = NO_PROGRESSION,
    recordsSettled = true,
  } = scatterProps;
  const { t } = useTranslation();
  const [plotType, setPlotType] = useState<PerformancePlotType>('scatter');
  const [requestedDirection, setRequestedDirection] = useState<ChartDirection | null>(null);
  const [requestedReference, setRequestedReference] = useState<FfiReferenceSource | undefined>(
    undefined
  );
  const [chosenId, setChosenId] = useState<string | null>(null);
  // A new read (another range or sport) clears the choice while rendering, so
  // the first frame drawn against it never carries the old attempt.
  const [chosenFor, setChosenFor] = useState(chartData);
  if (chartData !== chosenFor) {
    setChosenFor(chartData);
    setChosenId(null);
  }

  const { allPoints, drawn } = useMemo(() => splitAndPositionChartData(chartData), [chartData]);
  const hasForward = drawn.forward;
  const hasReverse = drawn.reverse;
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
  const shown = allPoints.filter(
    (point) => (point.direction === 'reverse' ? 'reverse' : 'forward') === direction
  );
  const trend =
    direction === 'reverse'
      ? useTimeAxis
        ? scatterProps.trendCurves.reverseTime
        : scatterProps.trendCurves.reverseSpeed
      : useTimeAxis
        ? scatterProps.trendCurves.forwardTime
        : scatterProps.trendCurves.forwardSpeed;

  const chosen = chosenId === null ? undefined : shown.find((point) => point.id === chosenId);
  const attempt = chosen ?? initialAttempt(shown, highlightedActivityId);

  const deltas = curves?.[direction];
  // The delta view draws the attempt chosen on the plot, else this activity.
  // With neither, or when that attempt has no curve, it draws the typical
  // attempt, which the engine gives only once enough laps exist, and failing
  // that the card's attempt among the rest.
  const pickedId = chosen?.activityId ?? highlightedActivityId;
  const pickedHasCurve =
    pickedId !== undefined && !!deltas?.laps.some((lap) => lap.activityId === pickedId);
  const typical = pickedHasCurve ? undefined : deltas?.splitSummary;
  const emphasisedId = pickedId ?? attempt?.activityId;

  // A view whose data has gone stops being shown, and does not return on its
  // own when the data does.
  const available = availablePlots({ histogram: !!histogram, curves: !!deltas });
  if (!available.includes(plotType)) setPlotType('scatter');
  const shownPlot: PerformancePlotType = available.includes(plotType) ? plotType : 'scatter';

  const highlightedTime = allPoints.find(
    (point) =>
      point.activityId === highlightedActivityId &&
      (point.direction === 'reverse' ? 'reverse' : 'forward') === direction
  )?.sectionTime;
  const recordTime = (direction === 'reverse' ? bestReverseRecord : bestForwardRecord)?.bestTime;
  const recordHeld = direction === 'reverse' ? bestReverseIsRecord : bestForwardIsRecord;

  const reference = deltas ? resolveReference(deltas, requestedReference) : undefined;
  const compareChoices = deltas && !typical ? referenceChoices(deltas) : [];
  const measured = useMemo(
    () => (deltas && reference !== undefined ? deltasAgainst(deltas, reference) : undefined),
    [deltas, reference]
  );
  const emphasisedLap =
    shownPlot === 'delta' && measured && !typical
      ? pickEmphasisedLap(measured.laps, emphasisedId)
      : undefined;
  const typicalLine = shownPlot === 'delta' && measured ? typical : undefined;
  const deltaPercents = useMemo(() => {
    // The typical lap is measured against the stored reference.
    if (typicalLine && deltas) {
      return splitPercents(typicalLine.medianSecs, referenceSplitSecs(deltas.laps));
    }
    if (emphasisedLap) {
      return splitPercents(emphasisedLap.splitDeltaSecs, referenceSplitSecs([emphasisedLap]));
    }
    return undefined;
  }, [typicalLine, deltas, emphasisedLap]);
  const deltaSplitStepM = curves?.splitStepM;
  const deltaSectionLengthM = curves?.sectionLengthM;
  useEffect(() => {
    if (!onDeltaLineChange) return;
    onDeltaLineChange(
      deltaPercents && deltaSplitStepM !== undefined && deltaSectionLengthM !== undefined
        ? {
            percents: deltaPercents,
            splitStepM: deltaSplitStepM,
            sectionLengthM: deltaSectionLengthM,
            direction,
          }
        : null
    );
  }, [onDeltaLineChange, deltaPercents, deltaSplitStepM, deltaSectionLengthM, direction]);
  // The map keeps no line of its own once the chart is gone.
  useEffect(() => () => onDeltaLineChange?.(null), [onDeltaLineChange]);

  const selectAttempt = (point: ScatterChartPoint) => {
    setChosenId(point.id);
    onActivitySelect?.(point.activityId, point.lapPoints, point.date);
  };
  const clearChoice = () => {
    setChosenId(null);
    onActivitySelect?.(null);
  };
  const excludedLink =
    excludedCount > 0 && onToggleShowExcluded ? (
      <ExcludedAttemptsLink
        count={excludedCount}
        shown={showExcluded}
        onToggle={onToggleShowExcluded}
      />
    ) : null;
  const showsCompare =
    shownPlot === 'delta' && compareChoices.length > 1 && reference !== undefined;
  const showsDirection = hasForward && hasReverse;
  const mapDirection = showsDirection ? direction : null;
  useEffect(() => {
    onShownDirectionChange?.(mapDirection);
  }, [onShownDirectionChange, mapDirection]);
  useEffect(() => () => onShownDirectionChange?.(null), [onShownDirectionChange]);

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
      {showsDirection || showsCompare ? (
        <View testID="performance-direction-row" style={styles.directionRow}>
          {showsDirection ? (
            <DirectionSwitch
              testID="section-chart-direction"
              style={styles.directionSwitch}
              value={direction}
              counts={{ forward: forwardStats?.count ?? 0, reverse: reverseStats?.count ?? 0 }}
              marks={{
                forward: directionColour('forward', isDark),
                reverse: directionColour('reverse', isDark),
              }}
              onChange={(value) => {
                setRequestedDirection(value);
                clearChoice();
              }}
            />
          ) : (
            <View />
          )}
          {showsCompare ? (
            <SelectButton
              testID="delta-compare"
              accessibilityLabel={t('sections.deltaCompareWith')}
              options={compareChoices.map((source) => ({
                value: String(source),
                label: t(referenceNameKey(source)),
              }))}
              value={String(reference)}
              onChange={(value) => setRequestedReference(Number(value) as FfiReferenceSource)}
            />
          ) : null}
        </View>
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
            highlightedActivityId={emphasisedId}
            reference={reference}
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
            <SectionScatterChart
              {...scatterProps}
              selectedDirection={direction}
              selectedPointId={attempt?.id}
              onSelectPoint={selectAttempt}
              showDataRowStart={excludedLink}
            />
          </Card>
          <ScatterLegend
            isDark={isDark}
            direction={direction}
            showTrend={!!trend && trend.length >= 2}
            showRecord={!!recordsSettled && shown.some((d) => d.isBest === true && !d.isExcluded)}
            showThisActivity={shown.some((d) => d.activityId === highlightedActivityId)}
            showOutsideBand={shown.some((d) => d.outsideDistanceBand === true)}
          />
        </>
      )}
      {attempt ? (
        <View style={styles.card}>
          <SelectedAttemptCard
            attempt={attempt}
            isDark={isDark}
            activityType={activityType}
            basis={attemptBasis(activityType, !!useTimeAxis)}
            thisActivityId={highlightedActivityId}
            progression={recordProgression[direction]}
            recordsSettled={recordsSettled}
            referenceActivityId={referenceActivityId}
            onSetAsReference={onSetAsReference}
            onExcludeActivity={
              onExcludeActivity
                ? (id) => {
                    onExcludeActivity(id);
                    clearChoice();
                  }
                : undefined
            }
            onIncludeActivity={
              onIncludeActivity
                ? (id) => {
                    onIncludeActivity(id);
                    clearChoice();
                  }
                : undefined
            }
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  directionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  // The switch grows from its words into the row's width, beside Compare with when it shows.
  directionSwitch: {
    flexGrow: 1,
    flexShrink: 1,
  },
  card: {
    marginTop: spacing.sm,
  },
  control: {
    alignSelf: 'center',
    marginBottom: spacing.xs,
  },
});
