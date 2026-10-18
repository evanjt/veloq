/**
 * Performance chart section for the section and route detail pages.
 * Uses a fixed-width scatter chart with a Gaussian kernel trend and a local
 * standard deviation band per direction.
 */

import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { PerformanceChartPanel } from './PerformanceChartPanel';
import { SectionStreamsNotice } from './SectionStreamsNotice';
import { ExcludedActivitiesToggle } from './SectionScatterChart';
import type {
  DirectionBestRecord,
  DirectionSummaryStats,
} from '@/features/routes/lib/performanceTypes';
import { SECTION_TIME_RANGES, type SectionTimeRange } from '@/features/routes/constants';
import { colors, darkColors, spacing, typography } from '@/theme';
import type { FfiAttemptHistograms, FfiSectionLapCurves, FfiSectionTrendCurves } from 'veloqrs';
import type { SectionDeltaLine } from '@/features/routes/lib/deltaLayout';
import type { ActivityType, RoutePoint, PerformanceDataPoint } from '@/types';
import { EmptyState, ErrorState, Shimmer, ToggleButtonRow } from '@/shared/ui';
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
  /** The engine's lap delta curves for the range and sport on screen. */
  curves?: FfiSectionLapCurves | undefined;
  /** Called with the attempt the delta plot emphasises while it is shown, else null. */
  onDeltaLineChange?: ((line: SectionDeltaLine | null) => void) | undefined;
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
  hasExcluded?: boolean | undefined;
  onToggleShowExcluded?: (() => void) | undefined;
  highlightedActivityId?: string | undefined;
  sectionTimeRange: SectionTimeRange;
  onTimeRangeChange: (range: SectionTimeRange) => void;
  /** Absent means settled. While streams load or failed, an empty chart is not a result. */
  streams?: SectionStreamsState | undefined;
}

export function SectionPerformanceSection({
  subject = 'section',
  isDark,
  sportType,
  chartData,
  trendCurves,
  histograms,
  curves,
  onDeltaLineChange,
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
  hasExcluded,
  onToggleShowExcluded,
  highlightedActivityId,
  sectionTimeRange,
  onTimeRangeChange,
  streams,
}: SectionPerformanceSectionProps) {
  const { t } = useTranslation();
  const hasEfforts = chartData.length > 0;
  const isRoute = subject === 'route';

  useEffect(() => {
    completeFlowAfterFrame(FLOW_EXPAND);
  }, [sectionTimeRange, chartData]);

  return (
    <View style={styles.chartSection}>
      <View style={styles.chartHeader}>
        <Text style={[styles.chartTitle, isDark && styles.chartTitleDark]}>
          {t('sections.performanceOverTime')}
        </Text>
        <ToggleButtonRow
          layout="hug"
          style={styles.timeRangePills}
          options={SECTION_TIME_RANGES.map((r) => ({
            value: r.id,
            label: t(r.labelKey as never),
            testID: `section-time-range-${r.id}`,
          }))}
          value={sectionTimeRange}
          onValueChange={(id) => {
            markFlow(FLOW_EXPAND);
            onTimeRangeChange(id);
          }}
        />
      </View>
      <Text testID={`${subject}-time-method`} style={[styles.method, isDark && styles.methodDark]}>
        {t(isRoute ? 'routes.timeMethod' : 'sections.timeMethod')}
      </Text>
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
          curves={curves}
          onDeltaLineChange={onDeltaLineChange}
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
          hasExcluded={hasExcluded}
          onToggleShowExcluded={onToggleShowExcluded}
          highlightedActivityId={highlightedActivityId}
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
          {hasExcluded && onToggleShowExcluded ? (
            <ExcludedActivitiesToggle
              isDark={isDark}
              showExcluded={!!showExcluded}
              onToggle={onToggleShowExcluded}
            />
          ) : null}
          <EmptyState variant="inline" title={t('sections.noActivitiesFound')} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  chartSection: {},
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  chartTitle: {
    ...typography.bodyBold,
    flexShrink: 1,
    color: colors.textPrimary,
  },
  chartTitleDark: {
    color: darkColors.textPrimary,
  },
  timeRangePills: {
    flexShrink: 0,
  },
  method: {
    ...typography.caption,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
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
