/**
 * The performance block of the section and route detail pages: one row of the
 * sport and range menus, then the panel with the timing method under
 * the plot, or what stands in for it while the time streams load, after they
 * failed, or when nothing is left.
 */

import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ExcludedAttemptsLink } from './ExcludedAttemptsLink';
import { PerformanceChartPanel } from './PerformanceChartPanel';
import { SectionStreamsNotice } from './SectionStreamsNotice';
import { SportSelectButton, type SportTypeOption } from '../SportSelectButton';
import type {
  DirectionBestRecord,
  DirectionSummaryStats,
} from '@/features/routes/lib/performanceTypes';
import { SECTION_TIME_RANGES, type SectionTimeRange } from '@/features/routes/constants';
import { PERIOD_LABEL_KEYS } from '@/shared/app/period';
import { colors, darkColors, spacing, typography } from '@/theme';
import type {
  FfiAttemptHistograms,
  FfiRecordProgressions,
  FfiScatterFocus,
  FfiSectionLapCurves,
  FfiSectionTrendCurves,
} from 'veloqrs';
import type { SectionDeltaLine } from '@/features/routes/lib/deltaLayout';
import type { ChartDirection } from '@/features/routes/lib/scatterData';
import type { ActivityType, RoutePoint, PerformanceDataPoint } from '@/types';
import { EmptyState, ErrorState, SelectButton, Shimmer } from '@/shared/ui';
import { attemptBasis, readsPace } from '@/features/routes/lib/attemptBasis';
import { FLOW_EXPAND, completeFlowAfterFrame, markFlow } from '@/shared/debug/flowTiming';
import type { UseSectionTimeStreamSyncResult } from '@/features/routes/hooks/useSectionPerformances';

/** Where the time streams the section's lap times depend on stand. */
export type SectionStreamsState =
  | { status: 'ready'; onRetry: () => void }
  | { status: 'loading'; onRetry: () => void }
  /** The wait ended with streams missing: the efforts read are a partial set. */
  | { status: 'partial'; outstanding: number; onRetry: () => void }
  | { status: 'failed'; error: unknown; onRetry: () => void };

/** The stream state a section screen draws from its time-stream sync. */
export function sectionStreamsState(
  sync: Pick<UseSectionTimeStreamSyncResult, 'ready' | 'error' | 'outstanding' | 'refetch'>
): SectionStreamsState {
  const onRetry = sync.refetch;
  if (sync.error) return { status: 'failed', error: sync.error, onRetry };
  if (!sync.ready) return { status: 'loading', onRetry };
  if (sync.outstanding > 0) return { status: 'partial', outstanding: sync.outstanding, onRetry };
  return { status: 'ready', onRetry };
}

export const PERFORMANCE_PLACEHOLDER_HEIGHT = 120;

/**
 * What the chart's attempts are: a section's laps, timed over the section, or
 * a route's whole activities, timed on moving time and plotted as times.
 */
export type PerformanceSubject = 'section' | 'route';

export interface SectionPerformanceSectionProps {
  /** Absent means a section. */
  subject?: PerformanceSubject | undefined;
  isDark: boolean;
  /** The sport whose efforts are plotted. Decides pace against speed units. */
  /** The sport on screen, absent until the engine has answered. */
  sportType: string | undefined;
  chartData: (PerformanceDataPoint & { x: number })[];
  /** The engine's trend curves for the range and sport on screen. */
  trendCurves: FfiSectionTrendCurves;
  /** The engine's attempt-time bins for the range and sport on screen. */
  histograms?: FfiAttemptHistograms | undefined;
  /** The engine's scatter range per direction, with the attempts past it counted. */
  scatterFocus?: FfiScatterFocus | undefined;
  /** The engine's record progression per direction. */
  recordProgression?: FfiRecordProgressions | undefined;
  /** The engine's lap delta curves for the range and sport on screen. */
  curves?: FfiSectionLapCurves | undefined;
  /** Called with the attempt the delta plot emphasises while it is shown, else null. */
  onDeltaLineChange?: ((line: SectionDeltaLine | null) => void) | undefined;
  /** Called with the direction the chart is on while both are drawn, else null. */
  onShownDirectionChange?: ((direction: ChartDirection | null) => void) | undefined;
  forwardStats: DirectionSummaryStats | null;
  reverseStats: DirectionSummaryStats | null;
  bestForwardRecord: DirectionBestRecord | null;
  bestReverseRecord: DirectionBestRecord | null;
  bestForwardIsRecord: boolean;
  bestReverseIsRecord: boolean;
  /**
   * Every activity's time stream is read, so the bests on screen are the
   * record. Until then no record mark is drawn. Absent means settled.
   */
  recordsSettled?: boolean | undefined;
  onActivitySelect: (activityId: string | null, activityPoints?: RoutePoint[], date?: Date) => void;
  onExcludeActivity?: ((activityId: string) => void) | undefined;
  onIncludeActivity?: ((activityId: string) => void) | undefined;
  onSetAsReference?: ((activityId: string) => void) | undefined;
  referenceActivityId?: string | undefined;
  showExcluded?: boolean | undefined;
  /** The excluded attempts the engine holds back for the range and sport on screen. */
  excludedCount?: number | undefined;
  onToggleShowExcluded?: (() => void) | undefined;
  highlightedActivityId?: string | undefined;
  sectionTimeRange: SectionTimeRange;
  onTimeRangeChange: (range: SectionTimeRange) => void;
  /** Absent means settled. While streams load or failed, an empty chart is not a result. */
  streams?: SectionStreamsState | undefined;
  /** The sports the read offers, as a menu beside the range; empty or absent draws none. */
  sportOptions?: readonly SportTypeOption[] | undefined;
  /** Called with the sport chosen. */
  onSelectSport?: ((sport: string) => void) | undefined;
}

export function SectionPerformanceSection({
  subject = 'section',
  isDark,
  sportType,
  chartData,
  trendCurves,
  histograms,
  scatterFocus,
  recordProgression,
  curves,
  onDeltaLineChange,
  onShownDirectionChange,
  forwardStats,
  reverseStats,
  bestForwardRecord,
  bestReverseRecord,
  bestForwardIsRecord,
  bestReverseIsRecord,
  recordsSettled,
  onActivitySelect,
  onExcludeActivity,
  onIncludeActivity,
  onSetAsReference,
  referenceActivityId,
  showExcluded,
  excludedCount = 0,
  onToggleShowExcluded,
  highlightedActivityId,
  sectionTimeRange,
  onTimeRangeChange,
  streams,
  sportOptions,
  onSelectSport,
}: SectionPerformanceSectionProps) {
  const { t } = useTranslation();
  const hasEfforts = chartData.length > 0;
  const isRoute = subject === 'route';
  const method = t(isRoute ? 'routes.timeMethod' : 'sections.timeMethod');
  // A time or a pace reads lower as faster, so the line says which way is up.
  const basis = attemptBasis(sportType as ActivityType, isRoute);
  const methodLine =
    basis === 'time' || readsPace(basis) ? t('sections.methodFasterAtTop', { method }) : method;
  const methodText = (
    <Text testID={`${subject}-time-method`} style={[styles.method, isDark && styles.methodDark]}>
      {methodLine}
    </Text>
  );

  useEffect(() => {
    completeFlowAfterFrame(FLOW_EXPAND);
  }, [sectionTimeRange, chartData]);

  return (
    <View style={styles.chartSection}>
      <View testID="performance-controls" style={styles.controls}>
        {sportOptions && sportOptions.length > 0 && onSelectSport ? (
          <SportSelectButton
            options={sportOptions}
            selectedType={sportType}
            onSelect={onSelectSport}
            style={styles.sport}
          />
        ) : null}
        <View style={styles.spacer} />
        <SelectButton
          testID="section-time-range"
          style={styles.timeRange}
          accessibilityLabel={t('settings.dateRange')}
          options={SECTION_TIME_RANGES.map((r) => ({
            value: r.id,
            label: t(PERIOD_LABEL_KEYS.long[r.id]),
          }))}
          value={sectionTimeRange}
          onChange={(id) => {
            markFlow(FLOW_EXPAND);
            onTimeRangeChange(id);
          }}
        />
      </View>
      {streams?.status === 'partial' ? (
        <SectionStreamsNotice
          isDark={isDark}
          outstanding={streams.outstanding}
          onRetry={streams.onRetry}
        />
      ) : null}
      {hasEfforts ? (
        <PerformanceChartPanel
          chartData={chartData}
          trendCurves={trendCurves}
          histograms={histograms}
          scatterFocus={scatterFocus}
          recordProgression={recordProgression}
          curves={curves}
          onDeltaLineChange={onDeltaLineChange}
          onShownDirectionChange={onShownDirectionChange}
          activityType={sportType as ActivityType}
          isDark={isDark}
          useTimeAxis={isRoute}
          bestForwardRecord={bestForwardRecord}
          bestReverseRecord={bestReverseRecord}
          bestForwardIsRecord={bestForwardIsRecord}
          bestReverseIsRecord={bestReverseIsRecord}
          recordsSettled={recordsSettled}
          forwardStats={forwardStats}
          reverseStats={reverseStats}
          onActivitySelect={onActivitySelect}
          onExcludeActivity={onExcludeActivity}
          onIncludeActivity={onIncludeActivity}
          onSetAsReference={onSetAsReference}
          referenceActivityId={referenceActivityId}
          showExcluded={showExcluded}
          excludedCount={excludedCount}
          onToggleShowExcluded={onToggleShowExcluded}
          highlightedActivityId={highlightedActivityId}
          footnote={methodText}
        />
      ) : streams?.status === 'loading' ? (
        <View testID="section-performance-pending" style={styles.emptyState}>
          <Shimmer height={PERFORMANCE_PLACEHOLDER_HEIGHT} />
        </View>
      ) : streams?.status === 'failed' ? (
        <ErrorState
          variant="inline"
          testID="section-performance-stream-failure"
          error={streams.error}
          onRetry={streams.onRetry}
        />
      ) : streams?.status === 'partial' ? null : (
        <View testID="section-performance-empty" style={styles.emptyState}>
          {/* Every attempt excluded leaves no chart to carry the eye, so it stays here. */}
          {excludedCount > 0 && onToggleShowExcluded ? (
            <ExcludedAttemptsLink
              count={excludedCount}
              shown={!!showExcluded}
              onToggle={onToggleShowExcluded}
            />
          ) : null}
          <EmptyState variant="inline" title={t('sections.noActivitiesFound')} />
        </View>
      )}
      {hasEfforts ? null : methodText}
    </View>
  );
}

const styles = StyleSheet.create({
  chartSection: {},
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  sport: {
    flexShrink: 1,
  },
  spacer: {
    flex: 1,
  },
  timeRange: {
    flexShrink: 0,
  },
  method: {
    ...typography.caption,
    paddingHorizontal: spacing.md,
    marginTop: spacing.xs,
    color: colors.textSecondary,
  },
  methodDark: {
    color: darkColors.textSecondary,
  },
  emptyState: {
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
});
